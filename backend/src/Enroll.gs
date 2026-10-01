/**
 * Enroll.gs — Enrollment endpoint (FR-1 through FR-6).
 *
 * Handles self-serve enrollment: lookup existing student or create new,
 * set face_dataset_path, record registration timestamp.
 * Re-enrollment appends (FR-5), never overwrites.
 */

/**
 * Handles an enrollment request.
 * @param {Object} payload - Parsed JSON body.
 * @param {string} payload.enrollment_no - Student enrollment number (required).
 * @param {string} [payload.name] - Student name (required if not in Master_Students).
 * @param {string} [payload.email] - Student email (required if not in Master_Students).
 * @returns {Object} Response object.
 */
function handleEnroll(payload) {
  // Validate required field
  if (!payload.enrollment_no) {
    return {
      success: false,
      error: 'enrollment_no is required'
    };
  }

  var config = getConfig();
  var enrollmentNo = String(payload.enrollment_no).trim();

  // Get Master_Students sheet
  var sheet = getSheet(config.MASTER_SHEET_ID, config.MASTER_STUDENTS_TAB);
  var data = getAllData(sheet);

  // Column indices are 1-based in config, convert to 0-based for array access
  var colEnrollment = config.MS_COL_ENROLLMENT - 1;
  var colName = config.MS_COL_NAME - 1;
  var colEmail = config.MS_COL_EMAIL - 1;
  var colFacePath = config.MS_COL_FACE_PATH - 1;
  var colRegistered = config.MS_COL_REGISTERED - 1;

  // Skip header row (index 0), search from index 1
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colEnrollment]).trim() === enrollmentNo) {
      rowIndex = i;
      break;
    }
  }

  var now = new Date();
  var isNew = (rowIndex === -1);
  var studentName, studentEmail;
  var facePath = '/Face-Dataset/' + enrollmentNo + '/';

  if (isNew) {
    // New student — name and email are required (FR-2)
    if (!payload.name || !payload.email) {
      return {
        success: false,
        error: 'name and email are required for new enrollment'
      };
    }

    studentName = String(payload.name).trim();
    studentEmail = String(payload.email).trim();

    // Append new row to Master_Students
    // Schema: enrollment_no, name, email, batch_tags, face_dataset_path, registered_at
    var newRow = [
      enrollmentNo,
      studentName,
      studentEmail,
      '',            // batch_tags — empty initially
      facePath,
      toISO(now)
    ];
    appendRowSafe(sheet, newRow);

  } else {
    // Existing student — confirm name/email from sheet (FR-2)
    studentName = data[rowIndex][colName] || '';
    studentEmail = data[rowIndex][colEmail] || '';

    // Update face_dataset_path and registered_at if not already set (FR-5: append, not overwrite)
    var existingFacePath = data[rowIndex][colFacePath];
    if (!existingFacePath) {
      // rowIndex is 0-based in data array; sheet rows are 1-based, +1 for header
      var sheetRow = rowIndex + 1;
      var updates = {};
      updates[config.MS_COL_FACE_PATH] = facePath;
      updates[config.MS_COL_REGISTERED] = toISO(now);
      updateRowSafe(sheet, sheetRow, updates);
    }
  }

  return {
    success: true,
    enrollment_no: enrollmentNo,
    name: studentName,
    email: studentEmail,
    is_new: isNew,
    face_dataset_path: facePath,
    registered_at: toISO(now)
  };
}
