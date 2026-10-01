/**
 * Backend unit tests — runs as a Node.js script.
 *
 * Tests the pure logic of the backend handlers by mocking Apps Script globals
 * (PropertiesService, SpreadsheetApp, ContentService, LockService, etc.).
 *
 * Run: node tests/test_backend.js
 */

// ─── Minimal Apps Script Mocks ───────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

// Script properties store
const scriptProperties = {
  SHARED_SECRET: 'test-secret-12345',
  MASTER_SHEET_ID: 'mock-master-id',
  ATTENDANCE_SHEET_ID: 'mock-attendance-id'
};

// In-memory sheet data store
const sheetDataStore = {};

function resetSheets() {
  sheetDataStore['mock-master-id'] = {
    'Master_Students': {
      data: [
        ['enrollment_no', 'name', 'email', 'batch_tags', 'face_dataset_path', 'registered_at'],
        ['2021001', 'Alice Student', 'alice@paruluniversity.ac.in', 'SCC/5-7', '/Face-Dataset/2021001/', '2026-01-15T10:00:00+05:30'],
        ['2021002', 'Bob Learner', 'bob@paruluniversity.ac.in', 'SCC/5-7,SCC/3-5', '', '']
      ]
    }
  };
  sheetDataStore['mock-attendance-id'] = {
    'Attendance_Log': {
      data: [
        ['session_id', 'enrollment_no', 'entry_time', 'exit_time', 'duration_mins', 'activity_form_status', 'activity_description', 'email_sent', 'notes']
      ]
    },
    'Other_Workshop_Attendees': {
      data: [
        ['id', 'name', 'enrollment_no', 'email', 'workshop_name', 'date']
      ]
    },
    'Embeddings': {
      data: [
        ['embeddings_json'],
        [JSON.stringify({
          version: 1,
          generated_at: '2026-09-30T12:00:00+05:30',
          model_version: 'facenet-v1',
          entries: [
            { enrollment_no: '2021001', embedding_vector: [0.1, 0.2, 0.3] }
          ]
        })]
      ]
    }
  };
}

// Mock globals
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (key) => scriptProperties[key] || null
  })
};

global.SpreadsheetApp = {
  openById: (id) => ({
    getSheetByName: (name) => {
      if (!sheetDataStore[id] || !sheetDataStore[id][name]) return null;
      const store = sheetDataStore[id][name];
      return {
        getDataRange: () => ({
          getNumRows: () => store.data.length,
          getValues: () => store.data.map(row => [...row])
        }),
        appendRow: (row) => store.data.push([...row]),
        getRange: (row, col) => ({
          setValue: (val) => {
            while (store.data.length < row) store.data.push([]);
            while (store.data[row - 1].length < col) store.data[row - 1].push('');
            store.data[row - 1][col - 1] = val;
          }
        }),
        clear: () => { store.data = []; }
      };
    }
  }),
  flush: () => {}
};

global.ContentService = {
  createTextOutput: (text) => ({
    _text: text,
    setMimeType: function() { return this; },
    getContent: function() { return this._text; }
  }),
  MimeType: { JSON: 'JSON' }
};

global.LockService = {
  getScriptLock: () => ({
    waitLock: () => {},
    releaseLock: () => {}
  })
};

global.Utilities = {
  getUuid: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
  formatDate: (date, tz, fmt) => {
    if (fmt === 'yyyy-MM-dd') {
      return date.toISOString().split('T')[0];
    }
    return date.toISOString();
  }
};

global.Session = {
  getScriptTimeZone: () => 'Asia/Kolkata'
};

// ─── Load source files ───────────────────────────────────────────────────────

const srcDir = path.join(__dirname, '..', 'src');
const srcFiles = ['Config.gs', 'Auth.gs', 'SheetHelpers.gs', 'Enroll.gs', 'Scan.gs', 'Embeddings.gs', 'Main.gs'];

for (const file of srcFiles) {
  const code = fs.readFileSync(path.join(srcDir, file), 'utf8');
  // Apps Script files define functions at global scope — eval them
  eval(code);
}

// ─── Test Runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || '') + ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── Auth Tests ──────────────────────────────────────────────────────────────

console.log('\n=== Auth Tests ===');

test('rejects request with no secret', () => {
  const result = validateSecret({ parameter: {}, postData: null });
  assert(!result.valid, 'Should be invalid');
  assert(result.error.includes('Missing'), 'Should mention missing secret');
});

test('rejects request with wrong secret', () => {
  const result = validateSecret({ parameter: { secret: 'wrong' }, postData: null });
  assert(!result.valid, 'Should be invalid');
  assert(result.error.includes('Invalid'), 'Should mention invalid secret');
});

test('accepts request with correct secret (query param)', () => {
  const result = validateSecret({ parameter: { secret: 'test-secret-12345' }, postData: null });
  assert(result.valid, 'Should be valid');
});

test('accepts request with correct secret (body)', () => {
  const result = validateSecret({
    parameter: {},
    postData: { contents: JSON.stringify({ secret: 'test-secret-12345' }) }
  });
  assert(result.valid, 'Should be valid');
});

// ─── Config Tests ────────────────────────────────────────────────────────────

console.log('\n=== Config Tests ===');

test('getConfig returns expected structure', () => {
  const config = getConfig();
  assertEqual(config.MASTER_STUDENTS_TAB, 'Master_Students');
  assertEqual(config.ATTENDANCE_LOG_TAB, 'Attendance_Log');
  assertEqual(config.SCAN_COOLDOWN_MS, 120000);
  assertEqual(config.MATCH_THRESHOLD, 0.65);
});

// ─── Enroll Tests ────────────────────────────────────────────────────────────

console.log('\n=== Enroll Tests ===');

test('enroll: rejects missing enrollment_no', () => {
  resetSheets();
  const result = handleEnroll({});
  assert(!result.success, 'Should fail');
  assert(result.error.includes('enrollment_no'), 'Should mention missing field');
});

test('enroll: finds existing student', () => {
  resetSheets();
  const result = handleEnroll({ enrollment_no: '2021001' });
  assert(result.success, 'Should succeed');
  assertEqual(result.is_new, false, 'Should not be new');
  assertEqual(result.name, 'Alice Student');
  assertEqual(result.email, 'alice@paruluniversity.ac.in');
});

test('enroll: creates new student', () => {
  resetSheets();
  const result = handleEnroll({
    enrollment_no: '2025999',
    name: 'New Person',
    email: 'new@test.com'
  });
  assert(result.success, 'Should succeed');
  assertEqual(result.is_new, true, 'Should be new');
  assertEqual(result.name, 'New Person');

  // Verify it was added to the sheet
  const data = sheetDataStore['mock-master-id']['Master_Students'].data;
  assertEqual(data.length, 4, 'Should have 4 rows (header + 2 original + 1 new)');
  assertEqual(data[3][0], '2025999', 'New row enrollment_no');
});

test('enroll: rejects new student without name/email', () => {
  resetSheets();
  const result = handleEnroll({ enrollment_no: '2099999' });
  assert(!result.success, 'Should fail');
  assert(result.error.includes('name and email'), 'Should explain what is missing');
});

test('enroll: sets face_dataset_path for existing student without one', () => {
  resetSheets();
  const result = handleEnroll({ enrollment_no: '2021002' });
  assert(result.success, 'Should succeed');
  assertEqual(result.face_dataset_path, '/Face-Dataset/2021002/');
});

// ─── Scan Tests ──────────────────────────────────────────────────────────────

console.log('\n=== Scan Tests ===');

test('scan: rejects missing enrollment_no', () => {
  resetSheets();
  const result = handleScan({});
  assert(!result.success, 'Should fail');
});

test('scan: entry creates new session', () => {
  resetSheets();
  const result = handleScan({ enrollment_no: '2021001' });
  assert(result.success, 'Should succeed');
  assertEqual(result.action, 'entry', 'Should be entry');
  assert(result.session_id, 'Should have session_id');
  assert(result.entry_time, 'Should have entry_time');
});

test('scan: exit closes open session', () => {
  resetSheets();

  // Manually create an open session from "today"
  const now = new Date();
  const entryTime = new Date(now.getTime() - 3600000); // 1 hour ago
  sheetDataStore['mock-attendance-id']['Attendance_Log'].data.push([
    'existing-session-123',
    '2021001',
    entryTime.toISOString(),
    '',  // no exit_time — open session
    '',
    'pending',
    '',
    'no',
    ''
  ]);

  // Need to wait past cooldown — mock the entry time to be > 2 min ago
  const result = handleScan({ enrollment_no: '2021001' });
  assert(result.success, 'Should succeed');
  assertEqual(result.action, 'exit', 'Should be exit');
  assert(result.exit_time, 'Should have exit_time');
  assert(typeof result.duration_mins === 'number', 'Should have duration_mins');
});

test('scan: routes non-member to workshop attendees (FR-12)', () => {
  resetSheets();
  const result = handleScan({
    enrollment_no: '9999999',
    name: 'Workshop Visitor',
    email: 'visitor@test.com',
    workshop_name: 'Swift Intro'
  });
  assert(result.success, 'Should succeed');
  assertEqual(result.action, 'workshop_attendee', 'Should be workshop attendee');

  // Verify it was added to Other_Workshop_Attendees
  const data = sheetDataStore['mock-attendance-id']['Other_Workshop_Attendees'].data;
  assertEqual(data.length, 2, 'Should have 2 rows (header + 1 new)');
  assertEqual(data[1][2], '9999999', 'Workshop attendee enrollment_no');
});

test('scan: cooldown rejects rapid re-scan (FR-11)', () => {
  resetSheets();

  // Create a recent exit (just now)
  const now = new Date();
  sheetDataStore['mock-attendance-id']['Attendance_Log'].data.push([
    'recent-session',
    '2021001',
    new Date(now.getTime() - 60000).toISOString(),  // entered 1 min ago
    now.toISOString(),                                // exited just now
    1,
    'pending',
    '',
    'no',
    ''
  ]);

  const result = handleScan({ enrollment_no: '2021001' });
  assert(!result.success, 'Should fail due to cooldown');
  assert(result.error.includes('Cooldown'), 'Should mention cooldown');
  assert(typeof result.cooldown_remaining_seconds === 'number', 'Should have remaining seconds');
});

// ─── Embeddings Tests ────────────────────────────────────────────────────────

console.log('\n=== Embeddings Tests ===');

test('get embeddings: returns stored embeddings', () => {
  resetSheets();
  const result = handleGetEmbeddings();
  assert(result.success, 'Should succeed');
  assert(result.embeddings, 'Should have embeddings');
  assertEqual(result.embeddings.version, 1);
  assertEqual(result.embeddings.entries.length, 1);
  assertEqual(result.embeddings.entries[0].enrollment_no, '2021001');
});

test('update embeddings: stores new embeddings', () => {
  resetSheets();
  const newEmbeddings = {
    version: 2,
    generated_at: '2026-10-01T12:00:00+05:30',
    model_version: 'facenet-v2',
    entries: [
      { enrollment_no: '2021001', embedding_vector: [0.4, 0.5, 0.6] },
      { enrollment_no: '2021002', embedding_vector: [0.7, 0.8, 0.9] }
    ]
  };
  const result = handleUpdateEmbeddings({ embeddings: newEmbeddings });
  assert(result.success, 'Should succeed');
  assertEqual(result.version, 2);
  assertEqual(result.entry_count, 2);

  // Verify we can read them back
  const readResult = handleGetEmbeddings();
  assert(readResult.success, 'Should read back successfully');
  assertEqual(readResult.embeddings.version, 2);
  assertEqual(readResult.embeddings.entries.length, 2);
});

test('update embeddings: rejects invalid schema', () => {
  resetSheets();
  const result = handleUpdateEmbeddings({ embeddings: { bad: 'data' } });
  assert(!result.success, 'Should fail');
  assert(result.error.includes('Invalid embeddings schema'), 'Should explain schema error');
});

// ─── Router Tests (doPost / doGet) ───────────────────────────────────────────

console.log('\n=== Router Tests ===');

test('doPost: rejects without auth', () => {
  resetSheets();
  const response = doPost({ parameter: {}, postData: { contents: '{"action":"status"}' } });
  const body = JSON.parse(response.getContent());
  assert(!body.success, 'Should fail');
  assert(body.error.includes('Missing'), 'Should mention missing secret');
});

test('doPost: routes enroll action', () => {
  resetSheets();
  const response = doPost({
    parameter: { secret: 'test-secret-12345' },
    postData: {
      contents: JSON.stringify({
        secret: 'test-secret-12345',
        action: 'enroll',
        enrollment_no: '2021001'
      })
    }
  });
  const body = JSON.parse(response.getContent());
  assert(body.success, 'Should succeed');
  assertEqual(body.name, 'Alice Student');
});

test('doPost: rejects unknown action', () => {
  resetSheets();
  const response = doPost({
    parameter: { secret: 'test-secret-12345' },
    postData: {
      contents: JSON.stringify({
        secret: 'test-secret-12345',
        action: 'nonexistent'
      })
    }
  });
  const body = JSON.parse(response.getContent());
  assert(!body.success, 'Should fail');
  assert(body.error.includes('Unknown action'), 'Should mention unknown action');
});

test('doGet: returns embeddings', () => {
  resetSheets();
  const response = doGet({
    parameter: { secret: 'test-secret-12345', action: 'embeddings' }
  });
  const body = JSON.parse(response.getContent());
  assert(body.success, 'Should succeed');
  assert(body.embeddings, 'Should have embeddings');
});

test('doGet: returns status', () => {
  resetSheets();
  const response = doGet({
    parameter: { secret: 'test-secret-12345', action: 'status' }
  });
  const body = JSON.parse(response.getContent());
  assert(body.success, 'Should succeed');
  assertEqual(body.status, 'online');
});

test('doGet: returns attendance log', () => {
  resetSheets();
  const response = doGet({
    parameter: { secret: 'test-secret-12345', action: 'attendance_log' }
  });
  const body = JSON.parse(response.getContent());
  assert(body.success, 'Should succeed');
  assert(Array.isArray(body.entries), 'Should have entries array');
});

test('doGet: returns students list', () => {
  resetSheets();
  const response = doGet({
    parameter: { secret: 'test-secret-12345', action: 'students' }
  });
  const body = JSON.parse(response.getContent());
  assert(body.success, 'Should succeed');
  assert(body.count >= 2, 'Should have at least 2 students');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`);
  }
}
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
