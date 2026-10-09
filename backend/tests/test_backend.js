/**
 * Backend tests — run the real src/*.gs files against in-memory Apps Script
 * services (tests/gas-mocks.js). No Google account needed.
 *
 * Run: node tests/test_backend.js
 */
const assert = require('assert');
const { createEnvironment } = require('./gas-mocks');

const KIOSK = 'kiosk-secret-0123456789';
const PIPELINE = 'pipeline-secret-0123456789';
const ADMIN = 'admin-secret-0123456789';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]).toString('base64');

function setup() {
  const env = createEnvironment();
  env.props = {
    KIOSK_SECRET: KIOSK,
    PIPELINE_SECRET: PIPELINE,
    ADMIN_SECRET: ADMIN,
    MASTER_SHEET_ID: 'master',
    ATTENDANCE_SHEET_ID: 'aatce',
    FACE_DATASET_FOLDER_ID: 'faces',
    EMBEDDINGS_FOLDER_ID: 'emb'
  };
  env.spreadsheets.master = {
    Master_Students: [
      ['enrollment_no', 'name', 'email', 'batch_tags', 'phone'],
      ['2021001', 'Alice Student', 'alice@paruluniversity.ac.in', 'SCC/5-7', '111'],
      ['2021002', 'Bob Learner', 'bob@paruluniversity.ac.in', 'SCC/5-7, SCC/3-5', '222']
    ]
  };
  const gs = env.gs;
  env.spreadsheets.aatce = {};
  Object.keys(gs.HEADERS).forEach((tab) => { env.spreadsheets.aatce[tab] = [[...gs.HEADERS[tab]]]; });
  env.addFolder('faces', 'Face-Dataset');
  env.addFolder('emb', 'Embeddings');
  env.addFolder('other', 'Somewhere else');
  env.kiosk = (action, params = {}) => env.post({ secret: KIOSK, action, ...params });
  env.pipeline = (action, params = {}) => env.post({ secret: PIPELINE, action, ...params });
  env.admin = (action, params = {}) => env.post({ secret: ADMIN, action, ...params });
  env.tab = (name) => env.spreadsheets.aatce[name];
  return env;
}

function vector(seed) {
  return Array.from({ length: 512 }, (_, i) => Math.sin(seed + i) / 10);
}

function embeddingsFile(version, ids = ['2021001']) {
  return {
    version,
    generated_at: '2026-10-05T03:00:00+00:00',
    model_version: 'facenet-inceptionresnetv1-vggface2',
    entries: ids.map((id, i) => ({ enrollment_no: id, embedding_vector: vector(i) }))
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ── Routing & auth ────────────────────────────────────────────────────────────
test('auth: misconfigured when no secrets are set', () => {
  const env = setup();
  env.props = {};
  assert.strictEqual(env.post({ secret: 'x', action: 'status' }).error_code, 'auth_misconfigured');
});

test('auth: missing secret', () => {
  assert.strictEqual(setup().post({ action: 'status' }).error_code, 'auth_missing');
});

test('auth: wrong secret', () => {
  assert.strictEqual(setup().post({ secret: 'nope', action: 'status' }).error_code, 'auth_invalid');
});

test('auth: each role can call status', () => {
  const env = setup();
  ['kiosk', 'pipeline', 'admin'].forEach((role) => {
    const res = env[role]('status');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.version, '2.0.0');
  });
});

test('auth: roles cannot call each other\'s actions', () => {
  const env = setup();
  assert.strictEqual(env.kiosk('students').error_code, 'forbidden');
  assert.strictEqual(env.kiosk('publish_embeddings', { embeddings: embeddingsFile(1) }).error_code, 'forbidden');
  assert.strictEqual(env.pipeline('scan', { enrollment_no: '2021001' }).error_code, 'forbidden');
  assert.strictEqual(env.admin('enroll', { enrollment_no: '2021001', consent: true }).error_code, 'forbidden');
});

test('router: unknown action', () => {
  assert.strictEqual(setup().kiosk('delete_everything').error_code, 'unknown_action');
});

test('router: invalid JSON and non-object bodies', () => {
  const env = setup();
  assert.strictEqual(env.postRaw('{not json').error_code, 'invalid_json');
  assert.strictEqual(env.postRaw('42').error_code, 'invalid_json');
});

test('router: GET without session is rejected', () => {
  const env = setup();
  const res = JSON.parse(env.gs.doGet({ parameter: {} }).content);
  assert.strictEqual(res.error_code, 'method_not_allowed');
});

test('router: internal errors become server_error', () => {
  const env = setup();
  delete env.props.MASTER_SHEET_ID;
  const res = env.kiosk('lookup', { enrollment_no: '2021001' });
  assert.strictEqual(res.error_code, 'server_error');
  assert.match(res.error, /MASTER_SHEET_ID/);
});

test('privacy: only entry points and owner-only functions are public', () => {
  const env = setup();
  const publicFns = Object.keys(env.gs)
    .filter(k => typeof env.gs[k] === 'function' && !k.endsWith('_') && k !== 'Date')
    .sort();
  assert.deepStrictEqual(publicFns,
    ['closeStaleSessions', 'doGet', 'doPost', 'installTriggers', 'setupSheets', 'submitActivity']);
});

// ── Lookup & enroll ───────────────────────────────────────────────────────────
test('lookup: member gets name and masked email', () => {
  const res = setup().kiosk('lookup', { enrollment_no: ' 2021001 ' });
  assert.strictEqual(res.is_member, true);
  assert.strictEqual(res.is_enrolled, false);
  assert.strictEqual(res.name, 'Alice Student');
  assert.strictEqual(res.email_hint, 'al•••@paruluniversity.ac.in');
});

test('lookup: unknown number', () => {
  const res = setup().kiosk('lookup', { enrollment_no: '999' });
  assert.strictEqual(res.is_member, false);
  assert.strictEqual(res.name, '');
});

test('lookup/enroll: malformed enrollment numbers are rejected', () => {
  const env = setup();
  ['', '../etc', 'a b', 'x'.repeat(33)].forEach((bad) => {
    assert.strictEqual(env.kiosk('lookup', { enrollment_no: bad }).error_code, 'validation_error');
  });
});

test('enroll: consent is required', () => {
  const env = setup();
  assert.strictEqual(env.kiosk('enroll', { enrollment_no: '2021001' }).error_code, 'consent_required');
  assert.strictEqual(env.kiosk('enroll', { enrollment_no: '2021001', consent: 'yes' }).error_code, 'consent_required');
  assert.strictEqual(env.tab('Face_Enrollments').length, 1);
});

test('enroll: member is recorded in Face_Enrollments, Master_Students untouched', () => {
  const env = setup();
  const before = JSON.stringify(env.spreadsheets.master);
  const res = env.kiosk('enroll', { enrollment_no: '2021001', consent: true, name: 'Ignored' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.is_member, true);
  assert.strictEqual(res.is_new, true);
  assert.strictEqual(res.name, 'Alice Student');
  assert.strictEqual(JSON.stringify(env.spreadsheets.master), before);
  const row = env.tab('Face_Enrollments')[1];
  assert.strictEqual(row[0], '2021001');
  assert.strictEqual(row[3], 'yes');
  assert.strictEqual(row[4], '2026-10-05T10:00:00+05:30');
});

test('enroll: non-member needs name and valid email', () => {
  const env = setup();
  assert.strictEqual(env.kiosk('enroll', { enrollment_no: 'W100', consent: true }).error_code, 'validation_error');
  assert.strictEqual(env.kiosk('enroll', { enrollment_no: 'W100', consent: true, name: 'Guest', email: 'nope' }).error_code, 'validation_error');
  const res = env.kiosk('enroll', { enrollment_no: 'W100', consent: true, name: 'Guest User', email: 'guest@gmail.com' });
  assert.strictEqual(res.is_member, false);
  assert.strictEqual(env.spreadsheets.master.Master_Students.length, 3);
});

test('enroll: re-enrollment updates the same row', () => {
  const env = setup();
  env.kiosk('enroll', { enrollment_no: '2021001', consent: true });
  env.advance(60);
  const res = env.kiosk('enroll', { enrollment_no: '2021001', consent: true });
  assert.strictEqual(res.is_new, false);
  assert.strictEqual(env.tab('Face_Enrollments').length, 2);
  assert.strictEqual(env.tab('Face_Enrollments')[1][4], '2026-10-05T11:00:00+05:30');
});

test('enroll: typed text cannot become a spreadsheet formula', () => {
  const env = setup();
  env.kiosk('enroll', { enrollment_no: 'W1', consent: true, name: '=IMPORTXML("http://x")', email: 'a@b.co' });
  assert.strictEqual(env.tab('Face_Enrollments')[1][1], '\'=IMPORTXML("http://x")');
});

// ── Face upload ───────────────────────────────────────────────────────────────
test('upload_faces: requires enrollment first', () => {
  assert.strictEqual(setup().kiosk('upload_faces', { enrollment_no: '2021001', images: [JPEG] }).error_code, 'not_enrolled');
});

test('upload_faces: saves JPEGs under Face-Dataset/<enrollment_no>/ and appends on re-upload', () => {
  const env = setup();
  env.kiosk('enroll', { enrollment_no: '2021001', consent: true });
  let res = env.kiosk('upload_faces', { enrollment_no: '2021001', images: [JPEG, JPEG, JPEG] });
  assert.strictEqual(res.saved, 3);
  assert.strictEqual(res.photo_count, 3);
  env.advance(5);
  res = env.kiosk('upload_faces', { enrollment_no: '2021001', images: [JPEG] });
  assert.strictEqual(res.photo_count, 4);

  const folders = env.foldersIn('faces');
  assert.strictEqual(folders.length, 1);
  assert.strictEqual(folders[0].name, '2021001');
  const files = env.filesIn(folders[0].id);
  assert.strictEqual(files.length, 4);
  assert.strictEqual(files[0].name, '20261005-100000-1.jpg');
  assert.strictEqual(files[0].mimeType, 'image/jpeg');
  assert.strictEqual(env.tab('Face_Enrollments')[1][5], 4);
});

test('upload_faces: rejects non-JPEG, oversized, bad base64 and too many images', () => {
  const env = setup();
  env.kiosk('enroll', { enrollment_no: '2021001', consent: true });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');
  const huge = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(201 * 1024)]).toString('base64');
  [[png], [huge], ['%%%'], [], Array(6).fill(JPEG), 'notarray'].forEach((images) => {
    assert.strictEqual(env.kiosk('upload_faces', { enrollment_no: '2021001', images }).error_code, 'validation_error');
  });
  assert.strictEqual(env.foldersIn('faces').length, 0);
});

// ── Scan ──────────────────────────────────────────────────────────────────────
test('scan: entry creates an open session', () => {
  const env = setup();
  const res = env.kiosk('scan', { enrollment_no: '2021001' });
  assert.strictEqual(res.action, 'entry');
  assert.strictEqual(res.name, 'Alice Student');
  assert.match(res.session_id, /^[0-9a-f-]{36}$/);
  const row = env.tab('Attendance_Log')[1];
  assert.deepStrictEqual(row.slice(1, 6), ['2021001', '2026-10-05T10:00:00+05:30', '', '', 'pending']);
});

test('scan: cooldown within 2 minutes', () => {
  const env = setup();
  env.kiosk('scan', { enrollment_no: '2021001' });
  env.advance(0.5);
  const res = env.kiosk('scan', { enrollment_no: '2021001' });
  assert.strictEqual(res.error_code, 'cooldown');
  assert.strictEqual(res.cooldown_remaining_seconds, 90);
  assert.strictEqual(env.tab('Attendance_Log').length, 2);
});

test('scan: short session exits without an activity email', () => {
  const env = setup();
  env.kiosk('scan', { enrollment_no: '2021001' });
  env.advance(5);
  const res = env.kiosk('scan', { enrollment_no: '2021001' });
  assert.strictEqual(res.action, 'exit');
  assert.strictEqual(res.duration_mins, 5);
  assert.strictEqual(res.activity_email_sent, false);
  assert.strictEqual(env.sentMail.length, 0);
  assert.strictEqual(env.tab('Attendance_Log')[1][5], 'skipped');
});

test('scan: long session exits and emails the activity form link', () => {
  const env = setup();
  const entry = env.kiosk('scan', { enrollment_no: '2021001' });
  env.advance(90);
  const res = env.kiosk('scan', { enrollment_no: '2021001' });
  assert.strictEqual(res.duration_mins, 90);
  assert.strictEqual(res.activity_email_sent, true);
  assert.strictEqual(env.sentMail.length, 1);
  assert.strictEqual(env.sentMail[0].to, 'alice@paruluniversity.ac.in');
  assert.ok(env.sentMail[0].htmlBody.includes('?session=' + entry.session_id));
  const row = env.tab('Attendance_Log')[1];
  assert.deepStrictEqual([row[3], row[4], row[7]], ['2026-10-05T11:30:00+05:30', 90, 'yes']);
});

test('activity email uses WEB_APP_URL when set', () => {
  const env = setup();
  env.props.WEB_APP_URL = 'https://script.google.com/macros/s/PUBLIC/exec';
  const { session_id } = env.kiosk('scan', { enrollment_no: '2021001' });
  env.advance(60);
  env.kiosk('scan', { enrollment_no: '2021001' });
  assert.ok(env.sentMail[0].htmlBody.includes('https://script.google.com/macros/s/PUBLIC/exec?session=' + session_id));
});

test('scan: a failed email does not fail the exit', () => {
  const env = setup();
  env.gs.MailApp.sendEmail = () => { throw new Error('Service invoked too many times'); };
  env.kiosk('scan', { enrollment_no: '2021001' });
  env.advance(60);
  const res = env.kiosk('scan', { enrollment_no: '2021001' });
  assert.strictEqual(res.action, 'exit');
  assert.strictEqual(res.activity_email_sent, false);
  assert.strictEqual(env.tab('Attendance_Log')[1][7], 'failed');
});

test('scan: third scan after exit opens a new session', () => {
  const env = setup();
  env.kiosk('scan', { enrollment_no: '2021001' });
  env.advance(30);
  env.kiosk('scan', { enrollment_no: '2021001' });
  env.advance(30);
  assert.strictEqual(env.kiosk('scan', { enrollment_no: '2021001' }).action, 'entry');
  assert.strictEqual(env.tab('Attendance_Log').length, 3);
});

test('scan: yesterday\'s unclosed session does not turn today\'s scan into an exit', () => {
  const env = setup();
  env.kiosk('scan', { enrollment_no: '2021001' });
  env.advance(24 * 60);
  assert.strictEqual(env.kiosk('scan', { enrollment_no: '2021001' }).action, 'entry');
});

test('scan: Date cells from Sheets are handled', () => {
  const env = setup();
  env.tab('Attendance_Log').push(['11111111-1111-4111-8111-111111111111', '2021002',
    new Date(env.clock - 45 * 60000), '', '', 'pending', '', 'no', '']);
  const res = env.kiosk('scan', { enrollment_no: '2021002' });
  assert.strictEqual(res.action, 'exit');
  assert.strictEqual(res.duration_mins, 45);
  assert.strictEqual(res.entry_time, '2026-10-05T09:15:00+05:30');
});

test('scan: enrolled non-member is logged once per day as a workshop attendee', () => {
  const env = setup();
  env.kiosk('enroll', { enrollment_no: 'W100', consent: true, name: 'Guest User', email: 'guest@gmail.com' });
  const first = env.kiosk('scan', { enrollment_no: 'W100', workshop_name: 'Swift Basics' });
  assert.strictEqual(first.action, 'workshop_attendee');
  assert.strictEqual(first.already_logged, false);
  env.advance(30);
  assert.strictEqual(env.kiosk('scan', { enrollment_no: 'W100' }).already_logged, true);
  const rows = env.tab('Other_Workshop_Attendees');
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[1].slice(1, 5), ['Guest User', 'W100', 'guest@gmail.com', 'Swift Basics']);
  assert.strictEqual(env.tab('Attendance_Log').length, 1);
});

test('scan: queued scans keep their original time (scanned_at)', () => {
  const env = setup();
  env.kiosk('scan', { enrollment_no: '2021001', scanned_at: '2026-10-05T09:00:00+05:30' });
  const exit = env.kiosk('scan', { enrollment_no: '2021001', scanned_at: '2026-10-05T09:40:00+05:30' });
  assert.strictEqual(exit.action, 'exit');
  assert.strictEqual(exit.duration_mins, 40);
  assert.strictEqual(exit.entry_time, '2026-10-05T09:00:00+05:30');
  assert.strictEqual(exit.exit_time, '2026-10-05T09:40:00+05:30');
});

test('scan: scanned_at must be recent and not in the future', () => {
  const env = setup();
  ['yesterday', '2026-10-04T09:59:00+05:30', '2026-10-05T10:05:00+05:30'].forEach((scanned_at) => {
    assert.strictEqual(env.kiosk('scan', { enrollment_no: '2021001', scanned_at }).error_code, 'validation_error');
  });
  const skewed = env.kiosk('scan', { enrollment_no: '2021001', scanned_at: '2026-10-05T10:01:00+05:30' });
  assert.strictEqual(skewed.entry_time, '2026-10-05T10:00:00+05:30', 'small clock skew is clamped to server time');
});

test('scan: manual scans are noted for audit', () => {
  const env = setup();
  env.kiosk('scan', { enrollment_no: '2021001', method: 'manual' });
  env.advance(30);
  env.kiosk('scan', { enrollment_no: '2021001', method: 'manual' });
  assert.strictEqual(env.tab('Attendance_Log')[1][8], 'manual entry; manual exit');
  env.advance(30);
  env.kiosk('scan', { enrollment_no: '2021001' });
  assert.strictEqual(env.tab('Attendance_Log')[2][8], '');
});

test('scan: unknown enrollment number asks to enroll', () => {
  assert.strictEqual(setup().kiosk('scan', { enrollment_no: '404' }).error_code, 'not_enrolled');
});

// ── Activity form ─────────────────────────────────────────────────────────────
test('activity: form page states', () => {
  const env = setup();
  const entry = env.kiosk('scan', { enrollment_no: '2021001' });
  const page = (session) => env.gs.doGet({ parameter: { session } }).template;
  assert.strictEqual(page('not-a-uuid').state, 'invalid');
  assert.strictEqual(page('00000000-0000-4000-8000-000000000000').state, 'invalid');
  const form = page(entry.session_id);
  assert.strictEqual(form.state, 'form');
  assert.strictEqual(form.file, 'ActivityForm');
  assert.strictEqual(form.sessionDate, 'Monday 5 October');
});

test('activity: submit saves once, validates input', () => {
  const env = setup();
  const { session_id } = env.kiosk('scan', { enrollment_no: '2021001' });
  assert.throws(() => env.gs.submitActivity(session_id, '   '), /describe/);
  assert.throws(() => env.gs.submitActivity(session_id, 'x'.repeat(1001)), /1000/);
  assert.throws(() => env.gs.submitActivity('00000000-0000-4000-8000-000000000000', 'hi'), /not valid/);
  assert.strictEqual(env.gs.submitActivity(session_id, '  Built a SwiftUI list  '), 'saved');
  assert.strictEqual(env.gs.submitActivity(session_id, 'again'), 'already_submitted');
  const row = env.tab('Attendance_Log')[1];
  assert.deepStrictEqual([row[5], row[6]], ['completed', 'Built a SwiftUI list']);
  assert.strictEqual(env.gs.doGet({ parameter: { session: session_id } }).template.state, 'done');
});

test('activity: nightly job flags missed exits once and emails the student', () => {
  const env = setup();
  env.kiosk('scan', { enrollment_no: '2021001' });
  env.kiosk('scan', { enrollment_no: '2021002' });
  env.advance(13 * 60); // 23:00 the same day
  env.gs.closeStaleSessions();
  assert.strictEqual(env.sentMail.length, 0, 'same-day sessions are left alone');

  env.advance(2 * 60); // 01:00 the next day
  env.kiosk('scan', { enrollment_no: '2021002' });
  env.gs.closeStaleSessions();
  env.gs.closeStaleSessions();
  const rows = env.tab('Attendance_Log');
  assert.strictEqual(rows[1][8], 'no exit scan');
  assert.strictEqual(rows[1][7], 'yes');
  assert.strictEqual(rows[3][8], '', 'today\'s open session untouched');
  assert.strictEqual(env.sentMail.length, 2);
  assert.ok(env.sentMail[0].htmlBody.includes('didn\'t see you check out'));
});

// ── Embeddings & dataset ──────────────────────────────────────────────────────
test('embeddings: version 0 and not_found before anything is published', () => {
  const env = setup();
  assert.strictEqual(env.kiosk('embeddings_version').version, 0);
  assert.strictEqual(env.kiosk('embeddings_download').error_code, 'not_found');
});

test('embeddings: publish → version → download round trip', () => {
  const env = setup();
  const file = embeddingsFile(1, ['2021001', 'W100']);
  const res = env.pipeline('publish_embeddings', { embeddings: file });
  assert.deepStrictEqual([res.success, res.version, res.entry_count], [true, 1, 2]);
  assert.strictEqual(env.filesIn('emb')[0].name, 'embeddings-v1.json');

  const version = env.kiosk('embeddings_version');
  assert.deepStrictEqual([version.version, version.entry_count, version.model_version],
    [1, 2, 'facenet-inceptionresnetv1-vggface2']);
  assert.strictEqual(version.drive_file_id, undefined, 'Drive IDs are not exposed');

  const download = env.kiosk('embeddings_download');
  assert.deepStrictEqual(download.embeddings, file);

  env.pipeline('publish_embeddings', { embeddings: embeddingsFile(2) });
  assert.strictEqual(env.kiosk('embeddings_download').embeddings.version, 2);
  assert.strictEqual(env.tab('Embeddings').length, 2, 'single metadata row');
});

test('embeddings: publish validation', () => {
  const env = setup();
  const cases = [
    [null, 'validation_error'],
    [{ ...embeddingsFile(1), version: '1' }, 'validation_error'],
    [{ ...embeddingsFile(1), model_version: '' }, 'validation_error'],
    [{ ...embeddingsFile(1), entries: [{ enrollment_no: '1', embedding_vector: [0.1] }] }, 'validation_error'],
    [{ ...embeddingsFile(1), entries: [{ enrollment_no: '../x', embedding_vector: vector(0) }] }, 'validation_error'],
    [embeddingsFile(1, ['2021001', '2021001']), 'validation_error']
  ];
  cases.forEach(([embeddings, code]) => {
    assert.strictEqual(env.pipeline('publish_embeddings', { embeddings }).error_code, code);
  });
  env.pipeline('publish_embeddings', { embeddings: embeddingsFile(3) });
  assert.strictEqual(env.pipeline('publish_embeddings', { embeddings: embeddingsFile(3) }).error_code, 'version_conflict');
});

test('dataset: manifest lists uploaded photos and face_images returns them', () => {
  const env = setup();
  env.kiosk('enroll', { enrollment_no: '2021001', consent: true });
  env.kiosk('upload_faces', { enrollment_no: '2021001', images: [JPEG, JPEG] });
  const manifest = env.pipeline('face_manifest');
  assert.strictEqual(manifest.people.length, 1);
  assert.strictEqual(manifest.people[0].enrollment_no, '2021001');
  assert.strictEqual(manifest.people[0].files.length, 2);

  const ids = manifest.people[0].files.map(f => f.id);
  const res = env.pipeline('face_images', { file_ids: ids });
  assert.deepStrictEqual(res.images.map(i => [i.file_id, i.data]), ids.map(id => [id, JPEG]));
});

test('dataset: face_images refuses files outside Face-Dataset and bad input', () => {
  const env = setup();
  env.pipeline('publish_embeddings', { embeddings: embeddingsFile(1) });
  const outside = env.filesIn('emb')[0].id;
  assert.strictEqual(env.pipeline('face_images', { file_ids: [outside] }).error_code, 'not_found');
  assert.strictEqual(env.pipeline('face_images', { file_ids: ['missing'] }).error_code, 'not_found');
  assert.strictEqual(env.pipeline('face_images', {}).error_code, 'validation_error');
  assert.strictEqual(env.pipeline('face_images', { file_ids: Array(26).fill('x') }).error_code, 'validation_error');
});

// ── Admin ─────────────────────────────────────────────────────────────────────
test('admin: occupancy lists today\'s open sessions with names', () => {
  const env = setup();
  env.kiosk('scan', { enrollment_no: '2021001' });
  env.kiosk('scan', { enrollment_no: '2021002' });
  env.advance(10);
  env.kiosk('scan', { enrollment_no: '2021002' });
  const res = env.admin('occupancy');
  assert.strictEqual(res.count, 1);
  assert.strictEqual(res.people[0].name, 'Alice Student');
  assert.strictEqual(res.people[0].batch_tags, 'SCC/5-7');
});

test('admin: attendance_log filters by date and enrollment_no', () => {
  const env = setup();
  env.kiosk('scan', { enrollment_no: '2021001' });
  env.kiosk('scan', { enrollment_no: '2021002' });
  env.advance(24 * 60);
  env.kiosk('scan', { enrollment_no: '2021001' });
  assert.strictEqual(env.admin('attendance_log').count, 3);
  assert.strictEqual(env.admin('attendance_log', { date: '2026-10-05' }).count, 2);
  assert.strictEqual(env.admin('attendance_log', { enrollment_no: '2021001' }).count, 2);
  const one = env.admin('attendance_log', { date: '2026-10-06', enrollment_no: '2021001' });
  assert.strictEqual(one.count, 1);
  assert.strictEqual(one.entries[0]._row, undefined, 'internal fields are not exposed');
});

test('admin: students joins enrollment status and filters by batch', () => {
  const env = setup();
  env.kiosk('enroll', { enrollment_no: '2021002', consent: true });
  env.kiosk('upload_faces', { enrollment_no: '2021002', images: [JPEG, JPEG, JPEG] });
  const all = env.admin('students');
  assert.strictEqual(all.count, 2);
  const bob = all.students.find(s => s.enrollment_no === '2021002');
  assert.deepStrictEqual([bob.face_enrolled, bob.photo_count], [true, 3]);
  assert.strictEqual(bob.phone, undefined, 'unmapped Master_Students columns are not exposed');
  assert.strictEqual(env.admin('students', { batch: 'SCC/3-5' }).count, 1);
  assert.strictEqual(env.admin('students', { batch: 'SCC/5' }).count, 0);
});

test('admin: workshop_attendees', () => {
  const env = setup();
  env.kiosk('enroll', { enrollment_no: 'W1', consent: true, name: 'Guest', email: 'g@x.io' });
  env.kiosk('scan', { enrollment_no: 'W1' });
  const res = env.admin('workshop_attendees');
  assert.strictEqual(res.count, 1);
  assert.strictEqual(res.attendees[0].name, 'Guest');
});

test('master sheet: missing required column is reported clearly', () => {
  const env = setup();
  env.spreadsheets.master.Master_Students[0][2] = 'mail';
  assert.match(env.kiosk('scan', { enrollment_no: '2021001' }).error, /missing column "email"/);
});

// ── Setup ─────────────────────────────────────────────────────────────────────
test('setup: creates missing tabs with headers and is idempotent', () => {
  const env = setup();
  env.spreadsheets.aatce = {};
  env.gs.setupSheets();
  env.gs.setupSheets();
  Object.keys(env.gs.HEADERS).forEach((tab) => {
    assert.strictEqual(JSON.stringify(env.tab(tab)), JSON.stringify([env.gs.HEADERS[tab]]));
  });
});

test('setup: rejects a tab with missing columns', () => {
  const env = setup();
  env.spreadsheets.aatce.Attendance_Log[0] = ['session_id'];
  assert.throws(() => env.gs.setupSheets(), /Attendance_Log is missing columns/);
});

test('setup: owner-only functions refuse anonymous callers', () => {
  const env = setup();
  env.activeUser = '';
  assert.throws(() => env.gs.setupSheets(), /script owner/);
  assert.throws(() => env.gs.installTriggers(), /script owner/);
  env.activeUser = 'owner@example.com';
  env.gs.installTriggers();
  env.gs.installTriggers();
  assert.deepStrictEqual(env.triggers, ['closeStaleSessions']);
});

// ── Runner ────────────────────────────────────────────────────────────────────
let failed = 0;
tests.forEach(({ name, fn }) => {
  try {
    fn();
    console.log('  ✓ ' + name);
  } catch (err) {
    failed++;
    console.log('  ✗ ' + name + '\n      ' + (err.stack || err).toString().split('\n').slice(0, 3).join('\n      '));
  }
});
console.log(`\n${tests.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
