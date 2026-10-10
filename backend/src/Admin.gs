/**
 * Admin.gs — Read-only actions for the admin portal (FR-19, FR-20).
 * Only the admin secret can call these (ROLE_ACTIONS in Config.gs).
 */

/**
 * Everything the portal shows, in one call. Each Apps Script request costs
 * ~1.5 s before any work starts, so one round trip instead of four.
 */
function handleDashboard_() {
  return {
    success: true,
    occupancy: handleOccupancy_().people,
    entries: handleAttendanceLog_({}).entries,
    students: handleStudents_({}).students,
    workshops: handleWorkshopAttendees_().attendees
  };
}

/** Who is in the lab right now: today's sessions with no exit. */
function handleOccupancy_() {
  var master = masterTable_();
  var today = dateKey_(new Date());
  var people = aatceTable_(TABS.ATTENDANCE_LOG).records
    .filter(function (r) { return !r.exit_time && dateKey_(r.entry_time) === today; })
    .map(function (r) {
      var member = findRecord_(master, MASTER_COLUMNS.enrollment_no, r.enrollment_no);
      return {
        session_id: String(r.session_id),
        enrollment_no: String(r.enrollment_no),
        name: member ? String(member[MASTER_COLUMNS.name] || '') : '',
        batch_tags: member ? String(member[MASTER_COLUMNS.batch_tags] || '') : '',
        entry_time: r.entry_time
      };
    });
  return { success: true, count: people.length, people: people };
}

/** Optional filters: date (yyyy-MM-dd), enrollment_no. */
function handleAttendanceLog_(body) {
  var date = String(body.date || '');
  var enrollmentNo = String(body.enrollment_no || '').trim();
  var entries = aatceTable_(TABS.ATTENDANCE_LOG).records
    .filter(function (r) {
      if (date && dateKey_(r.entry_time) !== date) return false;
      if (enrollmentNo && String(r.enrollment_no).trim() !== enrollmentNo) return false;
      return true;
    })
    .map(function (r) { return pick_(r, HEADERS.Attendance_Log); });
  return { success: true, count: entries.length, entries: entries };
}

/** Roster joined with face-enrollment status. Optional filter: batch. */
function handleStudents_(body) {
  var batch = String(body.batch || '').trim();
  var enrollments = aatceTable_(TABS.FACE_ENROLLMENTS);
  var students = masterTable_().records
    .filter(function (r) {
      if (!String(r[MASTER_COLUMNS.enrollment_no]).trim()) return false;
      return !batch || batchTags_(r[MASTER_COLUMNS.batch_tags]).indexOf(batch) !== -1;
    })
    .map(function (r) {
      var enrollmentNo = String(r[MASTER_COLUMNS.enrollment_no]).trim();
      var enrollment = findRecord_(enrollments, 'enrollment_no', enrollmentNo);
      return {
        enrollment_no: enrollmentNo,
        name: String(r[MASTER_COLUMNS.name] || ''),
        email: String(r[MASTER_COLUMNS.email] || ''),
        batch_tags: String(r[MASTER_COLUMNS.batch_tags] || ''),
        face_enrolled: !!enrollment,
        photo_count: enrollment ? Number(enrollment.photo_count) || 0 : 0,
        consent_at: enrollment ? String(enrollment.consent_at || '') : ''
      };
    });
  return { success: true, count: students.length, students: students };
}

function handleWorkshopAttendees_() {
  var attendees = aatceTable_(TABS.WORKSHOP_ATTENDEES).records
    .map(function (r) { return pick_(r, HEADERS.Other_Workshop_Attendees); });
  return { success: true, count: attendees.length, attendees: attendees };
}

function batchTags_(value) {
  return String(value || '').split(',').map(function (t) { return t.trim(); }).filter(String);
}

function pick_(record, headers) {
  var out = {};
  headers.forEach(function (h) { out[h] = record[h] !== undefined ? record[h] : ''; });
  return out;
}
