/**
 * SheetHelpers.gs — Data access layer for Google Sheets (NFR-7).
 *
 * All Sheet reads/writes go through these helpers.
 * Writes are wrapped in LockService to prevent concurrent-write corruption (PRD §8).
 * Reads use batch getDataRange().getValues() instead of per-row access (NFR-7).
 */

/**
 * Gets a sheet by tab name from a spreadsheet.
 * @param {string} spreadsheetId - The Spreadsheet ID.
 * @param {string} tabName - The tab/sheet name.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet(spreadsheetId, tabName) {
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    throw new Error('Sheet tab "' + tabName + '" not found in spreadsheet ' + spreadsheetId);
  }
  return sheet;
}

/**
 * Gets all data from a sheet as a 2D array (batch read per NFR-7).
 * Row 0 is the header row.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Array<Array<any>>}
 */
function getAllData(sheet) {
  var range = sheet.getDataRange();
  if (range.getNumRows() === 0) {
    return [];
  }
  return range.getValues();
}

/**
 * Finds the first row index (0-based, in the data array) where
 * the given column matches the given value.
 * @param {Array<Array<any>>} data - 2D array from getAllData().
 * @param {number} colIndex - 0-based column index.
 * @param {any} value - Value to match.
 * @returns {number} Row index (0-based) or -1 if not found.
 */
function findRowIndex(data, colIndex, value) {
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][colIndex]).trim() === String(value).trim()) {
      return i;
    }
  }
  return -1;
}

/**
 * Finds all row indices (0-based) where the given column matches the value.
 * @param {Array<Array<any>>} data - 2D array from getAllData().
 * @param {number} colIndex - 0-based column index.
 * @param {any} value - Value to match.
 * @returns {Array<number>} Array of matching row indices (0-based).
 */
function findAllRowIndices(data, colIndex, value) {
  var results = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][colIndex]).trim() === String(value).trim()) {
      results.push(i);
    }
  }
  return results;
}

/**
 * Appends a row to a sheet, wrapped in LockService to prevent concurrent-write issues.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array<any>} rowData - Array of values for the new row.
 */
function appendRowSafe(sheet, rowData) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // Wait up to 10 seconds
    sheet.appendRow(rowData);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Updates specific cells in a row, wrapped in LockService.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} rowNumber - 1-based row number in the sheet.
 * @param {Object} updates - Map of column number (1-based) to new value.
 */
function updateRowSafe(sheet, rowNumber, updates) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var keys = Object.keys(updates);
    for (var i = 0; i < keys.length; i++) {
      var col = parseInt(keys[i]);
      sheet.getRange(rowNumber, col).setValue(updates[col]);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Generates a UUID v4 for session IDs (FR-9).
 * @returns {string}
 */
function generateUUID() {
  return Utilities.getUuid();
}

/**
 * Gets today's date as a YYYY-MM-DD string (for session lookups).
 * @returns {string}
 */
function todayString() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Formats a Date as ISO 8601 string.
 * @param {Date} date
 * @returns {string}
 */
function toISO(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * Checks if a date string/Date is from today.
 * @param {any} dateValue - Date object or string.
 * @returns {boolean}
 */
function isToday(dateValue) {
  if (!dateValue) return false;
  var d = new Date(dateValue);
  if (isNaN(d.getTime())) return false;
  var today = todayString();
  var dateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return dateStr === today;
}
