/**
 * Scan.gs — Scan endpoint (FR-7 through FR-12).
 *
 * Handles routine entry/exit scans:
 * - Entry: creates new session with UUID, logs entry_time
 * - Exit: updates existing session with exit_time, computes duration
 * - Cooldown: rejects if last scan was < 2 minutes ago (FR-11)
 * - Non-members: routes to Other_Workshop_Attendees (FR-12)
 */

/**
 * Handles a scan request.
 * @param {Object} payload - Parsed JSON body.
 * @param {string} payload.enrollment_no - Student enrollment number (required).
 * @param {string} [payload.name] - Name (only needed for workshop attendees).
 * @param {string} [payload.email] - Email (only needed for workshop attendees).
 * @param {string} [payload.workshop_name] - Workshop name (for non-member attendees).
 * @returns {Object} Response object.
 */
function handleScan(payload) {
  if (!payload.enrollment_no) {
    return {
      success: false,
      error: 'enrollment_no is required'
    };
  }

  var config = getConfig();
  var enrollmentNo = String(payload.enrollment_no).trim();
  var now = new Date();

  // Step 1: Check if student exists in Master_Students
  var masterSheet = getSheet(config.MASTER_SHEET_ID, config.MASTER_STUDENTS_TAB);
  var masterData = getAllData(masterSheet);
  var colEnrollment = config.MS_COL_ENROLLMENT - 1;

  var studentRow = -1;
  for (var i = 1; i < masterData.length; i++) {
    if (String(masterData[i][colEnrollment]).trim() === enrollmentNo) {
      studentRow = i;
      break;
    }
  }

  // FR-12: Not in Master_Students → log to Other_Workshop_Attendees
  if (studentRow === -1) {
    return handleWorkshopAttendee(payload, config, now);
  }

  // Step 2: Check Attendance_Log for existing session today
  var logSheet = getSheet(config.ATTENDANCE_SHEET_ID, config.ATTENDANCE_LOG_TAB);
  var logData = getAllData(logSheet);

  var alColSessionId = config.AL_COL_SESSION_ID - 1;
  var alColEnrollment = config.AL_COL_ENROLLMENT - 1;
  var alColEntryTime = config.AL_COL_ENTRY_TIME - 1;
  var alColExitTime = config.AL_COL_EXIT_TIME - 1;
  var alColDuration = config.AL_COL_DURATION - 1;

  // Find open session today (has entry_time, no exit_time, from today)
  var openSessionRow = -1;
  var lastScanTime = null;

  for (var j = 1; j < logData.length; j++) {
    if (String(logData[j][alColEnrollment]).trim() === enrollmentNo) {
      var entryTime = logData[j][alColEntryTime];
      var exitTime = logData[j][alColExitTime];

      // Track the most recent scan time for cooldown check
      if (entryTime) {
        var entryDate = new Date(entryTime);
        if (!lastScanTime || entryDate > lastScanTime) {
          lastScanTime = entryDate;
        }
      }
      if (exitTime) {
        var exitDate = new Date(exitTime);
        if (!lastScanTime || exitDate > lastScanTime) {
          lastScanTime = exitDate;
        }
      }

      // Check for open session today
      if (isToday(entryTime) && !exitTime) {
        openSessionRow = j;
      }
    }
  }

  // FR-11: Enforce cooldown (2-minute minimum between scans)
  if (lastScanTime) {
    var elapsed = now.getTime() - lastScanTime.getTime();
    if (elapsed < config.SCAN_COOLDOWN_MS) {
      var remainingSec = Math.ceil((config.SCAN_COOLDOWN_MS - elapsed) / 1000);
      return {
        success: false,
        error: 'Cooldown active. Please wait ' + remainingSec + ' seconds.',
        cooldown_remaining_seconds: remainingSec
      };
    }
  }

  // Step 3: Entry or Exit
  if (openSessionRow === -1) {
    // FR-9: No open session today → ENTRY
    return handleEntry(logSheet, config, enrollmentNo, now);
  } else {
    // FR-10: Open session exists → EXIT
    return handleExit(logSheet, logData, config, openSessionRow, now);
  }
}

/**
 * Creates a new entry session.
 */
function handleEntry(logSheet, config, enrollmentNo, now) {
  var sessionId = generateUUID();
  var entryTime = toISO(now);

  // Schema: session_id, enrollment_no, entry_time, exit_time, duration_mins,
  //         activity_form_status, activity_description, email_sent, notes
  var newRow = [
    sessionId,
    enrollmentNo,
    entryTime,
    '',   // exit_time (empty — session is open)
    '',   // duration_mins
    'pending',  // activity_form_status
    '',   // activity_description
    'no', // email_sent
    ''    // notes
  ];

  appendRowSafe(logSheet, newRow);

  return {
    success: true,
    action: 'entry',
    session_id: sessionId,
    enrollment_no: enrollmentNo,
    entry_time: entryTime
  };
}

/**
 * Closes an open session (exit).
 */
function handleExit(logSheet, logData, config, openSessionRow, now) {
  var alColSessionId = config.AL_COL_SESSION_ID - 1;
  var alColEntryTime = config.AL_COL_ENTRY_TIME - 1;

  var sessionId = logData[openSessionRow][alColSessionId];
  var entryTime = new Date(logData[openSessionRow][alColEntryTime]);
  var exitTime = now;
  var durationMs = exitTime.getTime() - entryTime.getTime();
  var durationMins = Math.round(durationMs / 60000);

  // Update the row in the sheet (openSessionRow is 0-based in data; +1 for 1-based sheet row)
  var sheetRow = openSessionRow + 1;
  var updates = {};
  updates[config.AL_COL_EXIT_TIME] = toISO(exitTime);
  updates[config.AL_COL_DURATION] = durationMins;

  updateRowSafe(logSheet, sheetRow, updates);

  return {
    success: true,
    action: 'exit',
    session_id: sessionId,
    enrollment_no: String(logData[openSessionRow][config.AL_COL_ENROLLMENT - 1]).trim(),
    entry_time: toISO(entryTime),
    exit_time: toISO(exitTime),
    duration_mins: durationMins
  };
}

/**
 * Logs a non-member to Other_Workshop_Attendees (FR-12).
 */
function handleWorkshopAttendee(payload, config, now) {
  var sheet = getSheet(config.ATTENDANCE_SHEET_ID, config.OTHER_WORKSHOP_TAB);

  // Schema: id, name, enrollment_no, email, workshop_name, date
  var newRow = [
    generateUUID(),
    payload.name || 'Unknown',
    String(payload.enrollment_no).trim(),
    payload.email || '',
    payload.workshop_name || 'General',
    toISO(now)
  ];

  appendRowSafe(sheet, newRow);

  return {
    success: true,
    action: 'workshop_attendee',
    enrollment_no: String(payload.enrollment_no).trim(),
    message: 'Logged as workshop attendee (not in Master_Students roster)'
  };
}
