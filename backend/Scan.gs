/**
 * Scan.gs — POST /scan handler
 *
 * FR-8:  Accept scan payload (token, location?)
 * FR-9:  Validate token against enrolled records
 * FR-10: Log every scan event (valid or invalid) to Scans sheet
 * FR-11: Return scan result — valid (with student info) or invalid
 * FR-12: Record timestamp for each scan
 * FR-13: Reject duplicate scans within cooldown window
 */

function handleScan(payload) {
  const token = payload.token;
  if (!token) {
    return { success: false, error: 'Missing required field: token' };
  }

  const scanSheet = getSheet_(CONFIG.SHEET_IDS.SCANS, CONFIG.TABS.SCANS);
  const now = new Date();

  // FR-13: duplicate-scan cooldown check
  const lastScan = findByColumn_(scanSheet, 0, token); // col A = token
  if (lastScan) {
    const lastTime = new Date(lastScan.data[1]); // col B = scannedAt
    const diff = now.getTime() - lastTime.getTime();
    if (diff < CONFIG.SCAN_COOLDOWN_MS) {
      appendRow_(scanSheet, [
        token,
        now.toISOString(),
        'duplicate',
        payload.location || '',
        JSON.stringify({ cooldownRemainingMs: CONFIG.SCAN_COOLDOWN_MS - diff }),
      ]);
      return {
        success: true,
        result: 'duplicate',
        message: 'Scan rejected — within cooldown window',
        cooldownRemainingMs: CONFIG.SCAN_COOLDOWN_MS - diff,
      };
    }
  }

  // FR-9: validate token against enrolled
  const enrolledSheet = getSheet_(CONFIG.SHEET_IDS.ENROLLED, CONFIG.TABS.ENROLLED);
  const record = findByColumn_(enrolledSheet, 0, token); // col A = token

  if (!record) {
    // FR-10: log invalid scan
    appendRow_(scanSheet, [
      token,
      now.toISOString(),
      'invalid',
      payload.location || '',
      JSON.stringify({ reason: 'token_not_found' }),
    ]);
    // FR-11
    return { success: true, result: 'invalid', message: 'Token not recognized' };
  }

  // Check enrollment status
  const status = record.data[8]; // col I = status
  if (status !== 'active') {
    appendRow_(scanSheet, [
      token,
      now.toISOString(),
      'rejected',
      payload.location || '',
      JSON.stringify({ reason: 'enrollment_' + status }),
    ]);
    return {
      success: true,
      result: 'rejected',
      message: `Enrollment status: ${status}`,
    };
  }

  // FR-10 + FR-12: log valid scan with timestamp
  appendRow_(scanSheet, [
    token,
    now.toISOString(),
    'valid',
    payload.location || '',
    JSON.stringify({
      studentId: record.data[2],
      name: `${record.data[3]} ${record.data[4]}`,
    }),
  ]);

  // FR-11: return valid result with student info
  return {
    success: true,
    result: 'valid',
    student: {
      studentId: record.data[2],
      firstName: record.data[3],
      lastName: record.data[4],
      grade: record.data[6],
    },
    scannedAt: now.toISOString(),
  };
}
