/**
 * Sheets.gs — Google Sheets read/write helpers
 */

/**
 * Open a spreadsheet by ID and return the named tab (sheet).
 * Creates the tab if it doesn't exist.
 */
function getSheet_(spreadsheetId, tabName) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    // First row = headers
    if (tabName === CONFIG.TABS.ENROLLED) {
      sheet.appendRow([
        'token', 'pin', 'studentId', 'firstName', 'lastName',
        'email', 'grade', 'enrolledAt', 'status'
      ]);
    } else if (tabName === CONFIG.TABS.SCANS) {
      sheet.appendRow([
        'token', 'scannedAt', 'result', 'location', 'meta'
      ]);
    }
  }
  return sheet;
}

/**
 * Find a row by column value. Returns {row, data} or null.
 * colIndex is 0-based.
 */
function findByColumn_(sheet, colIndex, value) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) { // skip header
    if (String(data[i][colIndex]) === String(value)) {
      return { row: i + 1, data: data[i] };
    }
  }
  return null;
}

/**
 * Append a row and return the row number.
 */
function appendRow_(sheet, values) {
  sheet.appendRow(values);
  return sheet.getLastRow();
}

/**
 * Update a specific cell.
 */
function updateCell_(sheet, row, col, value) {
  sheet.getRange(row, col).setValue(value);
}
