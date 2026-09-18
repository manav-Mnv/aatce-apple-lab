/**
 * Enroll.gs — POST /enroll handler
 *
 * FR-1: Accept enrollment payload (studentId, firstName, lastName, email, grade)
 * FR-2: Generate unique token + PIN for each student
 * FR-3: Store enrollment in Google Sheets
 * FR-4: Validate required fields; reject if missing
 * FR-5: Return enrollment confirmation with token + PIN
 * FR-6: Support batch enrollment (array of students)
 * FR-7: Prevent duplicate enrollments by studentId
 */

function handleEnroll(payload) {
  // FR-6: batch enrollment — accept array or single object
  const students = Array.isArray(payload.students) ? payload.students : [payload];
  const results = [];
  const errors = [];

  const sheet = getSheet_(CONFIG.SHEET_IDS.ENROLLED, CONFIG.TABS.ENROLLED);

  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    const idx = i; // position in batch for error reporting

    // FR-4: validate required fields
    const required = ['studentId', 'firstName', 'lastName'];
    const missing = required.filter((f) => !s[f] || String(s[f]).trim() === '');
    if (missing.length > 0) {
      errors.push({
        index: idx,
        studentId: s.studentId || null,
        error: `Missing required fields: ${missing.join(', ')}`,
      });
      continue;
    }

    // FR-7: prevent duplicate by studentId
    const existing = findByColumn_(sheet, 2, s.studentId); // col C = studentId
    if (existing) {
      errors.push({
        index: idx,
        studentId: s.studentId,
        error: 'Student already enrolled',
      });
      continue;
    }

    // FR-2: generate token + pin
    const token = generateToken();
    const pin = generatePin();
    const now = new Date().toISOString();

    // FR-3: write to sheet
    appendRow_(sheet, [
      token,
      pin,
      s.studentId,
      s.firstName || '',
      s.lastName || '',
      s.email || '',
      s.grade || '',
      now,
      'active',
    ]);

    // FR-5: return confirmation
    results.push({
      token,
      pin,
      studentId: s.studentId,
      name: `${s.firstName} ${s.lastName}`,
      enrolledAt: now,
    });
  }

  return {
    success: errors.length === 0,
    enrolled: results,
    errors: errors.length > 0 ? errors : undefined,
    count: results.length,
  };
}
