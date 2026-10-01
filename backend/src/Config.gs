/**
 * Config.gs — Central configuration for the AATCE backend.
 *
 * All sheet names, column indices, and tunable constants live here.
 * Secrets are never hardcoded — they live in Script Properties (NFR-8).
 */

/** Google Sheets workbook IDs — set these in Script Properties, not here. */
function getConfig() {
  var props = PropertiesService.getScriptProperties();
  return {
    // Sheet IDs (set via Script Properties in the Apps Script editor)
    MASTER_SHEET_ID: props.getProperty('MASTER_SHEET_ID') || '',
    ATTENDANCE_SHEET_ID: props.getProperty('ATTENDANCE_SHEET_ID') || '',

    // Sheet tab names
    MASTER_STUDENTS_TAB: 'Master_Students',
    ATTENDANCE_LOG_TAB: 'Attendance_Log',
    OTHER_WORKSHOP_TAB: 'Other_Workshop_Attendees',
    EMBEDDINGS_TAB: 'Embeddings',

    // Master_Students columns (1-indexed, matching SRS §6)
    // enrollment_no, name, email, batch_tags, face_dataset_path, registered_at
    MS_COL_ENROLLMENT: 1,
    MS_COL_NAME: 2,
    MS_COL_EMAIL: 3,
    MS_COL_BATCH: 4,
    MS_COL_FACE_PATH: 5,
    MS_COL_REGISTERED: 6,

    // Attendance_Log columns (1-indexed, matching SRS §6)
    // session_id, enrollment_no, entry_time, exit_time, duration_mins,
    // activity_form_status, activity_description, email_sent, notes
    AL_COL_SESSION_ID: 1,
    AL_COL_ENROLLMENT: 2,
    AL_COL_ENTRY_TIME: 3,
    AL_COL_EXIT_TIME: 4,
    AL_COL_DURATION: 5,
    AL_COL_FORM_STATUS: 6,
    AL_COL_ACTIVITY_DESC: 7,
    AL_COL_EMAIL_SENT: 8,
    AL_COL_NOTES: 9,

    // Other_Workshop_Attendees columns (1-indexed)
    // id, name, enrollment_no, email, workshop_name, date
    OW_COL_ID: 1,
    OW_COL_NAME: 2,
    OW_COL_ENROLLMENT: 3,
    OW_COL_EMAIL: 4,
    OW_COL_WORKSHOP: 5,
    OW_COL_DATE: 6,

    // Tunable constants
    SCAN_COOLDOWN_MS: 2 * 60 * 1000,       // 2-minute cooldown (FR-11)
    MATCH_THRESHOLD: 0.65,                   // cosine similarity threshold (FR-7)
    SESSION_TIMEOUT_MS: 60 * 60 * 1000       // 1-hour auto-exit trigger (FR-14)
  };
}
