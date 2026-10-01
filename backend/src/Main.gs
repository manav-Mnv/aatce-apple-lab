/**
 * Main.gs — Apps Script Web App entry points (doPost / doGet).
 *
 * Routes requests to the appropriate handler based on the 'action' parameter.
 * All requests must pass shared-secret authentication via X-Shared-Secret
 * header (FR-13, NFR-4).
 *
 * POST actions: enroll, scan, update_embeddings_meta
 * GET actions:  embeddings_version, status, attendance_log, students
 */

/**
 * Handles HTTP POST requests.
 * @param {GoogleAppsScript.Events.DoPost} e - The POST event.
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  try {
    // Auth check (FR-13, NFR-4) — X-Shared-Secret header
    var auth = validateSecret(e);
    if (!auth.valid) {
      return jsonResponse({
        success: false,
        error: auth.error,
        error_code: auth.error_code
      });
    }

    // Parse JSON body
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        return jsonResponse({
          success: false,
          error: 'Invalid JSON body',
          error_code: 'invalid_json'
        });
      }
    }

    // Route by action
    var action = payload.action || '';
    var result;

    switch (action) {
      case 'enroll':
        result = handleEnroll(payload);
        break;

      case 'scan':
        result = handleScan(payload);
        break;

      case 'update_embeddings_meta':
        result = handleUpdateEmbeddingsMeta(payload);
        break;

      default:
        result = {
          success: false,
          error: 'Unknown action: ' + action + '. Valid POST actions: enroll, scan, update_embeddings_meta',
          error_code: 'unknown_action'
        };
    }

    return jsonResponse(result);

  } catch (err) {
    return jsonResponse({
      success: false,
      error: 'Internal server error: ' + err.message,
      error_code: 'server_error'
    });
  }
}

/**
 * Handles HTTP GET requests.
 * @param {GoogleAppsScript.Events.DoGet} e - The GET event.
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doGet(e) {
  try {
    // Auth check (FR-13, NFR-4) — X-Shared-Secret header
    var auth = validateSecret(e);
    if (!auth.valid) {
      return jsonResponse({
        success: false,
        error: auth.error,
        error_code: auth.error_code
      });
    }

    var action = (e && e.parameter && e.parameter.action) || '';
    var result;

    switch (action) {
      case 'embeddings_version':
        result = handleGetEmbeddingsVersion();
        break;

      case 'status':
        result = handleStatus();
        break;

      case 'attendance_log':
        result = handleGetAttendanceLog(e.parameter);
        break;

      case 'students':
        result = handleGetStudents(e.parameter);
        break;

      default:
        result = {
          success: false,
          error: 'Unknown action: ' + action + '. Valid GET actions: embeddings_version, status, attendance_log, students',
          error_code: 'unknown_action'
        };
    }

    return jsonResponse(result);

  } catch (err) {
    return jsonResponse({
      success: false,
      error: 'Internal server error: ' + err.message,
      error_code: 'server_error'
    });
  }
}

// ─── Read-only endpoints (for Admin Portal, FR-20) ────────────────────────────

/**
 * Returns a simple health/status check.
 */
function handleStatus() {
  return {
    success: true,
    status: 'online',
    timestamp: toISO(new Date()),
    version: '1.0.0'
  };
}

/**
 * Returns attendance log entries, optionally filtered by date or enrollment_no.
 * @param {Object} params - Query parameters.
 * @param {string} [params.date] - Filter by date (YYYY-MM-DD).
 * @param {string} [params.enrollment_no] - Filter by enrollment number.
 */
function handleGetAttendanceLog(params) {
  var config = getConfig();
  var sheet = getSheet(config.ATTENDANCE_SHEET_ID, config.ATTENDANCE_LOG_TAB);
  var data = getAllData(sheet);

  if (data.length <= 1) {
    return { success: true, entries: [], count: 0 };
  }

  var entries = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var entry = {
      session_id: row[config.AL_COL_SESSION_ID - 1],
      enrollment_no: row[config.AL_COL_ENROLLMENT - 1],
      entry_time: row[config.AL_COL_ENTRY_TIME - 1],
      exit_time: row[config.AL_COL_EXIT_TIME - 1],
      duration_mins: row[config.AL_COL_DURATION - 1],
      activity_form_status: row[config.AL_COL_FORM_STATUS - 1],
      activity_description: row[config.AL_COL_ACTIVITY_DESC - 1],
      email_sent: row[config.AL_COL_EMAIL_SENT - 1],
      notes: row[config.AL_COL_NOTES - 1]
    };

    // Apply filters
    var include = true;

    if (params && params.date && entry.entry_time) {
      var entryDate = Utilities.formatDate(
        new Date(entry.entry_time),
        Session.getScriptTimeZone(),
        'yyyy-MM-dd'
      );
      if (entryDate !== params.date) {
        include = false;
      }
    }

    if (params && params.enrollment_no) {
      if (String(entry.enrollment_no).trim() !== String(params.enrollment_no).trim()) {
        include = false;
      }
    }

    if (include) {
      entries.push(entry);
    }
  }

  return {
    success: true,
    count: entries.length,
    entries: entries
  };
}

/**
 * Returns the student roster from Master_Students, optionally filtered.
 * @param {Object} params - Query parameters.
 * @param {string} [params.batch] - Filter by batch tag.
 * @param {string} [params.enrollment_no] - Filter by specific enrollment number.
 */
function handleGetStudents(params) {
  var config = getConfig();
  var sheet = getSheet(config.MASTER_SHEET_ID, config.MASTER_STUDENTS_TAB);
  var data = getAllData(sheet);

  if (data.length <= 1) {
    return { success: true, students: [], count: 0 };
  }

  var students = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var student = {
      enrollment_no: row[config.MS_COL_ENROLLMENT - 1],
      name: row[config.MS_COL_NAME - 1],
      email: row[config.MS_COL_EMAIL - 1],
      batch_tags: row[config.MS_COL_BATCH - 1],
      face_dataset_path: row[config.MS_COL_FACE_PATH - 1],
      registered_at: row[config.MS_COL_REGISTERED - 1]
    };

    // Apply filters
    var include = true;

    if (params && params.enrollment_no) {
      if (String(student.enrollment_no).trim() !== String(params.enrollment_no).trim()) {
        include = false;
      }
    }

    if (params && params.batch && student.batch_tags) {
      var batches = String(student.batch_tags).split(',');
      var found = false;
      for (var b = 0; b < batches.length; b++) {
        if (batches[b].trim() === params.batch.trim()) {
          found = true;
          break;
        }
      }
      if (!found) include = false;
    }

    if (include) {
      students.push(student);
    }
  }

  return {
    success: true,
    count: students.length,
    students: students
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Creates a JSON response.
 * @param {Object} data - Response data.
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
