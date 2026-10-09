/**
 * Config.gs — Central configuration for the AATCE backend.
 *
 * IDs and secrets live in Script Properties (NFR-8), never in code.
 * Columns are located by header name, so the real sheets may contain
 * extra columns or a different column order.
 */

var TABS = {
  MASTER_STUDENTS: 'Master_Students',
  ATTENDANCE_LOG: 'Attendance_Log',
  WORKSHOP_ATTENDEES: 'Other_Workshop_Attendees',
  FACE_ENROLLMENTS: 'Face_Enrollments',
  EMBEDDINGS: 'Embeddings'
};

/** Header rows for the tabs this backend owns (created by setupSheets()). */
var HEADERS = {
  Attendance_Log: ['session_id', 'enrollment_no', 'entry_time', 'exit_time', 'duration_mins',
    'activity_form_status', 'activity_description', 'email_sent', 'notes'],
  Other_Workshop_Attendees: ['id', 'name', 'enrollment_no', 'email', 'workshop_name', 'date'],
  Face_Enrollments: ['enrollment_no', 'name', 'email', 'is_member', 'consent_at',
    'photo_count', 'enrolled_at', 'updated_at'],
  Embeddings: ['version', 'generated_at', 'model_version', 'drive_file_id', 'entry_count']
};

/**
 * Header names in the existing SCC registration sheet (read-only for this backend).
 * Change the right-hand values if the real sheet uses different header text.
 */
var MASTER_COLUMNS = {
  enrollment_no: 'enrollment_no',
  name: 'name',
  email: 'email',
  batch_tags: 'batch_tags'
};

/** Which actions each secret may call (NFR-4). */
var ROLE_ACTIONS = {
  kiosk: ['status', 'lookup', 'enroll', 'upload_faces', 'scan', 'embeddings_version', 'embeddings_download'],
  pipeline: ['status', 'embeddings_version', 'face_manifest', 'face_images', 'publish_embeddings'],
  admin: ['status', 'embeddings_version', 'occupancy', 'attendance_log', 'students', 'workshop_attendees']
};

/** Script Property that holds each role's secret. */
var ROLE_SECRET_PROPERTY = {
  kiosk: 'KIOSK_SECRET',
  pipeline: 'PIPELINE_SECRET',
  admin: 'ADMIN_SECRET'
};

/** Actions that write data — run under the script lock end to end. */
var WRITE_ACTIONS = ['enroll', 'upload_faces', 'scan', 'publish_embeddings'];

var SCAN_COOLDOWN_MS = 2 * 60 * 1000;          // FR-11
var ACTIVITY_EMAIL_MIN_MINUTES = 15;           // FR-14: no form for accidental short sessions
var MAX_UPLOAD_IMAGES = 5;                     // FR-3: 3–5 frames per enrollment
var MAX_IMAGE_BYTES = 200 * 1024;
var MAX_FACE_IMAGES_PER_CALL = 25;
var MAX_ACTIVITY_CHARS = 1000;
var EMBEDDING_DIM = 512;
var ENROLLMENT_NO_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

var NO_EXIT_NOTE = 'no exit scan';

/*
 * Every internal function ends with "_". Apps Script treats those as private:
 * they cannot be called through google.script.run from the activity-form page,
 * so the only public entry points are doGet, doPost, submitActivity and the
 * owner-only setup/trigger functions in Setup.gs and Activity.gs.
 */

function getProp_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function requireProp_(name) {
  var value = getProp_(name);
  if (!value) throw new Error(name + ' is not set in Script Properties');
  return value;
}
