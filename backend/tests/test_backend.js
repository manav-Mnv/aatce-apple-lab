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
        ['version', 'generated_at', 'model_version', 'drive_file_id', 'entry_count'],
        [1, '2026-09-30T12:00:00+05:30', 'facenet-v1', '1AbCdEfG_driveFileId', 1]
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

// ─── Helper: build mock event objects ────────────────────────────────────────

function makePostEvent(body, headers) {
  return {
    headers: headers || {},
    parameter: {},
    postData: { contents: JSON.stringify(body) }
  };
}

function makeGetEvent(params, headers) {
  return {
    headers: headers || {},
    parameter: params || {}
  };
}

const AUTH_HEADER = { 'X-Shared-Secret': 'test-secret-12345' };

// ─── Auth Tests ──────────────────────────────────────────────────────────────

console.log('\n=== Auth Tests ===');

test('rejects request with no secret', () => {
  const result = validateSecret({ headers: {}, parameter: {}, postData: null });
  assert(!result.valid, 'Should be invalid');
  assertEqual(result.error_code, 'auth_missing');
});

test('rejects request with wrong secret (header)', () => {
  const result = validateSecret({ headers: { 'X-Shared-Secret': 'wrong' }, parameter: {} });
  assert(!result.valid, 'Should be invalid');
  assertEqual(result.error_code, 'auth_invalid');
});

test('accepts request with correct secret (header)', () => {
  const result = validateSecret({ headers: AUTH_HEADER, parameter: {} });
  assert(result.valid, 'Should be valid');
});

test('accepts request with correct secret (body fallback)', () => {
  const result = validateSecret({
    headers: {},
    parameter: {},
    postData: { contents: JSON.stringify({ secret: 'test-secret-12345' }) }
  });
  assert(result.valid, 'Should be valid via body fallback');
});

test('header takes precedence over body', () => {
  const result = validateSecret({
    headers: { 'X-Shared-Secret': 'test-secret-12345' },
    parameter: {},
    postData: { contents: JSON.stringify({ secret: 'wrong-secret' }) }
  });
  assert(result.valid, 'Header should take precedence');
});

test('case-insensitive header name', () => {
  const result = validateSecret({
    headers: { 'x-shared-secret': 'test-secret-12345' },
    parameter: {}
  });
  assert(result.valid, 'Should accept lowercase header');
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
  assert(!result.success);
  assertEqual(result.error_code, 'validation_error');
});

test('enroll: finds existing student', () => {
  resetSheets();
  const result = handleEnroll({ enrollment_no: '2021001' });
  assert(result.success);
  assertEqual(result.is_new, false);
  assertEqual(result.name, 'Alice Student');
});

test('enroll: creates new student', () => {
  resetSheets();
  const result = handleEnroll({
    enrollment_no: '2025999',
    name: 'New Person',
    email: 'new@test.com'
  });
  assert(result.success);
  assertEqual(result.is_new, true);
  const data = sheetDataStore['mock-master-id']['Master_Students'].data;
  assertEqual(data.length, 4);
});

test('enroll: rejects new student without name/email', () => {
  resetSheets();
  const result = handleEnroll({ enrollment_no: '2099999' });
  assert(!result.success);
  assertEqual(result.error_code, 'validation_error');
});

test('enroll: sets face_dataset_path for existing student without one', () => {
  resetSheets();
  const result = handleEnroll({ enrollment_no: '2021002' });
  assert(result.success);
  assertEqual(result.face_dataset_path, '/Face-Dataset/2021002/');
});

// ─── Scan Tests ──────────────────────────────────────────────────────────────

console.log('\n=== Scan Tests ===');

test('scan: rejects missing enrollment_no', () => {
  resetSheets();
  const result = handleScan({});
  assert(!result.success);
  assertEqual(result.error_code, 'validation_error');
});

test('scan: entry creates new session', () => {
  resetSheets();
  const result = handleScan({ enrollment_no: '2021001' });
  assert(result.success);
  assertEqual(result.action, 'entry');
  assert(result.session_id);
  assert(result.entry_time);
});

test('scan: exit closes open session', () => {
  resetSheets();
  const now = new Date();
  const entryTime = new Date(now.getTime() - 3600000);
  sheetDataStore['mock-attendance-id']['Attendance_Log'].data.push([
    'existing-session-123', '2021001', entryTime.toISOString(), '', '',
    'pending', '', 'no', ''
  ]);
  const result = handleScan({ enrollment_no: '2021001' });
  assert(result.success);
  assertEqual(result.action, 'exit');
  assert(typeof result.duration_mins === 'number');
});

test('scan: routes non-member to workshop attendees (FR-12)', () => {
  resetSheets();
  const result = handleScan({
    enrollment_no: '9999999', name: 'Workshop Visitor',
    email: 'visitor@test.com', workshop_name: 'Swift Intro'
  });
  assert(result.success);
  assertEqual(result.action, 'workshop_attendee');
});

test('scan: cooldown rejects rapid re-scan with error_code (FR-11)', () => {
  resetSheets();
  const now = new Date();
  sheetDataStore['mock-attendance-id']['Attendance_Log'].data.push([
    'recent-session', '2021001',
    new Date(now.getTime() - 60000).toISOString(),
    now.toISOString(), 1, 'pending', '', 'no', ''
  ]);
  const result = handleScan({ enrollment_no: '2021001' });
  assert(!result.success);
  assertEqual(result.error_code, 'cooldown');
  assert(typeof result.cooldown_remaining_seconds === 'number');
});

// ─── Embeddings Version Tests ────────────────────────────────────────────────

console.log('\n=== Embeddings Version Tests ===');

test('get embeddings version: returns metadata (not full vectors)', () => {
  resetSheets();
  const result = handleGetEmbeddingsVersion();
  assert(result.success);
  assertEqual(result.version, 1);
  assertEqual(result.drive_file_id, '1AbCdEfG_driveFileId');
  assert(result.download_url.includes('1AbCdEfG_driveFileId'));
  // Should NOT contain entries or embedding_vector
  assert(!result.entries, 'Should not have entries (full vectors stay in Drive)');
});

test('get embeddings version: empty when no data', () => {
  resetSheets();
  sheetDataStore['mock-attendance-id']['Embeddings'].data = [
    ['version', 'generated_at', 'model_version', 'drive_file_id', 'entry_count']
  ];
  const result = handleGetEmbeddingsVersion();
  assert(result.success);
  assertEqual(result.version, 0);
  assertEqual(result.download_url, '');
});

test('update embeddings meta: stores metadata', () => {
  resetSheets();
  const result = handleUpdateEmbeddingsMeta({
    version: 2,
    generated_at: '2026-10-01T12:00:00+05:30',
    model_version: 'facenet-v2',
    drive_file_id: 'newDriveFileId123',
    entry_count: 42
  });
  assert(result.success);
  assertEqual(result.version, 2);

  // Verify we can read it back
  const readResult = handleGetEmbeddingsVersion();
  assertEqual(readResult.version, 2);
  assertEqual(readResult.drive_file_id, 'newDriveFileId123');
  assertEqual(readResult.entry_count, 42);
});

test('update embeddings meta: rejects missing fields', () => {
  resetSheets();
  const result = handleUpdateEmbeddingsMeta({ version: 1 });
  assert(!result.success);
  assertEqual(result.error_code, 'validation_error');
});

// ─── Router Tests (doPost / doGet) ───────────────────────────────────────────

console.log('\n=== Router Tests ===');

test('doPost: rejects without auth header', () => {
  resetSheets();
  const response = doPost(makePostEvent({ action: 'status' }));
  const body = JSON.parse(response.getContent());
  assert(!body.success);
  assertEqual(body.error_code, 'auth_missing');
});

test('doPost: routes enroll with header auth', () => {
  resetSheets();
  const response = doPost(makePostEvent(
    { action: 'enroll', enrollment_no: '2021001' },
    AUTH_HEADER
  ));
  const body = JSON.parse(response.getContent());
  assert(body.success);
  assertEqual(body.name, 'Alice Student');
});

test('doPost: rejects unknown action with error_code', () => {
  resetSheets();
  const response = doPost(makePostEvent(
    { action: 'nonexistent' },
    AUTH_HEADER
  ));
  const body = JSON.parse(response.getContent());
  assert(!body.success);
  assertEqual(body.error_code, 'unknown_action');
});

test('doPost: rejects invalid JSON with error_code', () => {
  resetSheets();
  const response = doPost({
    headers: AUTH_HEADER,
    parameter: {},
    postData: { contents: 'not json {{' }
  });
  const body = JSON.parse(response.getContent());
  assert(!body.success);
  assertEqual(body.error_code, 'invalid_json');
});

test('doGet: returns embeddings version (not full data)', () => {
  resetSheets();
  const response = doGet(makeGetEvent(
    { action: 'embeddings_version' },
    AUTH_HEADER
  ));
  const body = JSON.parse(response.getContent());
  assert(body.success);
  assertEqual(body.version, 1);
  assert(body.drive_file_id);
  assert(!body.entries, 'GET should return metadata only');
});

test('doGet: returns status', () => {
  resetSheets();
  const response = doGet(makeGetEvent({ action: 'status' }, AUTH_HEADER));
  const body = JSON.parse(response.getContent());
  assert(body.success);
  assertEqual(body.status, 'online');
});

test('doGet: returns attendance log', () => {
  resetSheets();
  const response = doGet(makeGetEvent({ action: 'attendance_log' }, AUTH_HEADER));
  const body = JSON.parse(response.getContent());
  assert(body.success);
  assert(Array.isArray(body.entries));
});

test('doGet: returns students list', () => {
  resetSheets();
  const response = doGet(makeGetEvent({ action: 'students' }, AUTH_HEADER));
  const body = JSON.parse(response.getContent());
  assert(body.success);
  assert(body.count >= 2);
});

test('doGet: rejects unknown action with error_code', () => {
  resetSheets();
  const response = doGet(makeGetEvent({ action: 'bad' }, AUTH_HEADER));
  const body = JSON.parse(response.getContent());
  assert(!body.success);
  assertEqual(body.error_code, 'unknown_action');
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
