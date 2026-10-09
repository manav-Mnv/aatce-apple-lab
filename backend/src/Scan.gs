/**
 * Scan.gs — Entry/exit scans (FR-7 to FR-12, FR-14).
 *
 * Members (in Master_Students):
 *   - no open session today → entry (new session_id)
 *   - open session today    → exit (exit_time, duration_mins, activity email)
 *   - any scan within SCAN_COOLDOWN_MS of the last one → `cooldown`
 * Enrolled non-members are logged once per day to Other_Workshop_Attendees.
 * Unknown enrollment numbers get `not_enrolled` so the kiosk can offer enrollment.
 *
 * `scanned_at` (optional, ISO 8601) is the moment the kiosk saw the face. The
 * kiosk sends it when replaying scans queued while offline (NFR-2), so entry and
 * exit times stay true. It must be within the last 24 hours and not in the future.
 *
 * `method: "manual"` marks scans where the student typed their enrollment number
 * instead of being recognised (FR-8). They are noted in Attendance_Log so admins
 * can spot proxy check-ins.
 */

var MAX_SCAN_AGE_MS = 24 * 60 * 60 * 1000;
var MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

function handleScan_(body) {
  var enrollmentNo = cleanEnrollmentNo_(body.enrollment_no);
  if (!enrollmentNo) return invalidEnrollmentNo_();

  var now = scanTime_(body.scanned_at);
  if (!now) {
    return errorResult_('scanned_at must be an ISO 8601 time within the last 24 hours', 'validation_error');
  }
  var member = findRecord_(masterTable_(), MASTER_COLUMNS.enrollment_no, enrollmentNo);
  if (!member) return logWorkshopAttendee_(enrollmentNo, body.workshop_name, now);

  var log = aatceTable_(TABS.ATTENDANCE_LOG);
  var today = dateKey_(now);
  var lastScanMs = 0;
  var open = null;

  log.records.forEach(function (r) {
    if (String(r.enrollment_no).trim() !== enrollmentNo) return;
    [r.entry_time, r.exit_time].forEach(function (t) {
      var ms = t ? new Date(t).getTime() : NaN;
      if (ms > lastScanMs) lastScanMs = ms;
    });
    if (!r.exit_time && dateKey_(r.entry_time) === today) open = r;
  });

  var elapsed = now.getTime() - lastScanMs;
  if (lastScanMs && elapsed >= 0 && elapsed < SCAN_COOLDOWN_MS) {
    var remaining = Math.ceil((SCAN_COOLDOWN_MS - elapsed) / 1000);
    var result = errorResult_('Cooldown active. Please wait ' + remaining + ' seconds.', 'cooldown');
    result.cooldown_remaining_seconds = remaining;
    return result;
  }

  var person = memberIdentity_(member);
  var manual = body.method === 'manual';
  return open
    ? recordExit_(log, open, person, now, manual)
    : recordEntry_(log, enrollmentNo, person, now, manual);
}

/** @returns {Date|null} the scan time, or null if `scannedAt` is given but unacceptable. */
function scanTime_(scannedAt) {
  var serverNow = new Date();
  if (scannedAt === undefined || scannedAt === null || scannedAt === '') return serverNow;
  var t = new Date(String(scannedAt));
  var age = serverNow.getTime() - t.getTime();
  if (isNaN(age) || age > MAX_SCAN_AGE_MS || age < -MAX_CLOCK_SKEW_MS) return null;
  return age < 0 ? serverNow : t;
}

function recordEntry_(log, enrollmentNo, person, now, manual) {
  var session = {
    session_id: Utilities.getUuid(),
    enrollment_no: enrollmentNo,
    entry_time: toISO_(now),
    activity_form_status: 'pending',
    email_sent: 'no',
    notes: manual ? 'manual entry' : ''
  };
  appendRecord_(log, session);

  return {
    success: true,
    action: 'entry',
    session_id: session.session_id,
    enrollment_no: enrollmentNo,
    name: person.name,
    entry_time: session.entry_time
  };
}

function recordExit_(log, session, person, now, manual) {
  var durationMins = Math.round((now.getTime() - new Date(session.entry_time).getTime()) / 60000);
  var changes = { exit_time: toISO_(now), duration_mins: durationMins };
  if (manual) {
    changes.notes = session.notes ? session.notes + '; manual exit' : 'manual exit';
  }

  if (durationMins >= ACTIVITY_EMAIL_MIN_MINUTES) {
    changes.email_sent = sendActivityEmail_(session, person, durationMins) ? 'yes' : 'failed';
  } else {
    changes.activity_form_status = 'skipped';
  }
  updateRecord_(log, session, changes);

  return {
    success: true,
    action: 'exit',
    session_id: session.session_id,
    enrollment_no: String(session.enrollment_no).trim(),
    name: person.name,
    entry_time: session.entry_time,
    exit_time: changes.exit_time,
    duration_mins: durationMins,
    activity_email_sent: changes.email_sent === 'yes'
  };
}

/** FR-12: one row per attendee per day. */
function logWorkshopAttendee_(enrollmentNo, workshopName, now) {
  var enrollment = findRecord_(aatceTable_(TABS.FACE_ENROLLMENTS), 'enrollment_no', enrollmentNo);
  if (!enrollment) {
    return errorResult_('Enrollment number not found. Please enroll first.', 'not_enrolled');
  }

  var attendees = aatceTable_(TABS.WORKSHOP_ATTENDEES);
  var today = dateKey_(now);
  var alreadyLogged = attendees.records.some(function (r) {
    return String(r.enrollment_no).trim() === enrollmentNo && dateKey_(r.date) === today;
  });

  if (!alreadyLogged) {
    appendRecord_(attendees, {
      id: Utilities.getUuid(),
      name: enrollment.name,
      enrollment_no: enrollmentNo,
      email: enrollment.email,
      workshop_name: String(workshopName || '').trim() || 'General',
      date: toISO_(now)
    });
  }

  return {
    success: true,
    action: 'workshop_attendee',
    enrollment_no: enrollmentNo,
    name: String(enrollment.name || ''),
    already_logged: alreadyLogged
  };
}
