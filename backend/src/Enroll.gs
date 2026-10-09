/**
 * Enroll.gs — Self-serve enrollment (FR-1 to FR-6, NFR-3).
 *
 * Flow on the kiosk:
 *   lookup        → show the student's name for confirmation (FR-2)
 *   enroll        → record consent + identity in Face_Enrollments
 *   upload_faces  → save 3–5 face crops to Face-Dataset/<enrollment_no>/ (FR-4)
 *
 * Master_Students (the SCC registration sheet) is never written to. Members
 * are recognised by being in it; everyone else is a workshop attendee whose
 * name/email live only in Face_Enrollments (FR-12).
 */

function handleLookup_(body) {
  var enrollmentNo = cleanEnrollmentNo_(body.enrollment_no);
  if (!enrollmentNo) return invalidEnrollmentNo_();

  var member = findRecord_(masterTable_(), MASTER_COLUMNS.enrollment_no, enrollmentNo);
  var enrollment = findRecord_(aatceTable_(TABS.FACE_ENROLLMENTS), 'enrollment_no', enrollmentNo);
  var person = member ? memberIdentity_(member) : enrollment;

  return {
    success: true,
    enrollment_no: enrollmentNo,
    is_member: !!member,
    is_enrolled: !!enrollment,
    name: person ? String(person.name || '') : '',
    email_hint: person ? maskEmail_(person.email) : '',
    photo_count: enrollment ? Number(enrollment.photo_count) || 0 : 0
  };
}

function handleEnroll_(body) {
  var enrollmentNo = cleanEnrollmentNo_(body.enrollment_no);
  if (!enrollmentNo) return invalidEnrollmentNo_();
  if (body.consent !== true) {
    return errorResult_('Biometric consent is required to enroll', 'consent_required');
  }

  var member = findRecord_(masterTable_(), MASTER_COLUMNS.enrollment_no, enrollmentNo);
  var person = member
    ? memberIdentity_(member)
    : { name: String(body.name || '').trim(), email: String(body.email || '').trim() };

  if (!member && (!person.name || !isEmail_(person.email))) {
    return errorResult_('name and a valid email are required for non-members', 'validation_error');
  }

  var enrollments = aatceTable_(TABS.FACE_ENROLLMENTS);
  var existing = findRecord_(enrollments, 'enrollment_no', enrollmentNo);
  var now = toISO_(new Date());
  var fields = {
    name: person.name,
    email: person.email,
    is_member: member ? 'yes' : 'no',
    consent_at: now,
    updated_at: now
  };

  if (existing) {
    updateRecord_(enrollments, existing, fields);
  } else {
    fields.enrollment_no = enrollmentNo;
    fields.photo_count = 0;
    fields.enrolled_at = now;
    appendRecord_(enrollments, fields);
  }

  return {
    success: true,
    enrollment_no: enrollmentNo,
    name: person.name,
    email_hint: maskEmail_(person.email),
    is_member: !!member,
    is_new: !existing,
    photo_count: existing ? Number(existing.photo_count) || 0 : 0
  };
}

/** Saves face crops to Drive. Re-enrollment adds photos, never replaces them (FR-5). */
function handleUploadFaces_(body) {
  var enrollmentNo = cleanEnrollmentNo_(body.enrollment_no);
  if (!enrollmentNo) return invalidEnrollmentNo_();

  var images = body.images;
  if (!Array.isArray(images) || images.length === 0 || images.length > MAX_UPLOAD_IMAGES) {
    return errorResult_('images must be an array of 1–' + MAX_UPLOAD_IMAGES + ' base64 JPEG strings', 'validation_error');
  }

  var enrollments = aatceTable_(TABS.FACE_ENROLLMENTS);
  var enrollment = findRecord_(enrollments, 'enrollment_no', enrollmentNo);
  if (!enrollment) return errorResult_('Enroll with consent before uploading photos', 'not_enrolled');

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  var blobs = [];
  for (var i = 0; i < images.length; i++) {
    var bytes = decodeJpeg_(images[i]);
    if (!bytes) {
      return errorResult_('images[' + i + '] must be a base64 JPEG under ' + MAX_IMAGE_BYTES + ' bytes', 'validation_error');
    }
    blobs.push(Utilities.newBlob(bytes, 'image/jpeg', stamp + '-' + (i + 1) + '.jpg'));
  }

  var folder = personFolder_(enrollmentNo);
  blobs.forEach(function (blob) { folder.createFile(blob); });

  var photoCount = (Number(enrollment.photo_count) || 0) + blobs.length;
  updateRecord_(enrollments, enrollment, { photo_count: photoCount, updated_at: toISO_(new Date()) });

  return { success: true, enrollment_no: enrollmentNo, saved: blobs.length, photo_count: photoCount };
}

function decodeJpeg_(value) {
  var bytes;
  try {
    bytes = Utilities.base64Decode(String(value));
  } catch (err) {
    return null;
  }
  var isJpeg = bytes.length > 2 && (bytes[0] & 0xff) === 0xff && (bytes[1] & 0xff) === 0xd8;
  return isJpeg && bytes.length <= MAX_IMAGE_BYTES ? bytes : null;
}

function personFolder_(enrollmentNo) {
  var root = DriveApp.getFolderById(requireProp_('FACE_DATASET_FOLDER_ID'));
  var existing = root.getFoldersByName(enrollmentNo);
  return existing.hasNext() ? existing.next() : root.createFolder(enrollmentNo);
}

function memberIdentity_(member) {
  return {
    name: String(member[MASTER_COLUMNS.name] || '').trim(),
    email: String(member[MASTER_COLUMNS.email] || '').trim()
  };
}

/** "alice@uni.ac.in" → "al•••@uni.ac.in" — enough for a student to recognise, not to harvest. */
function maskEmail_(email) {
  var s = String(email || '');
  var at = s.indexOf('@');
  if (at < 1) return '';
  return s.slice(0, Math.min(2, at)) + '•••' + s.slice(at);
}

function isEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function invalidEnrollmentNo_() {
  return errorResult_('enrollment_no is required (letters, digits, "-" or "_", max 32)', 'validation_error');
}
