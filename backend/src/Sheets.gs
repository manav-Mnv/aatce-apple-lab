/**
 * Sheets.gs — Data access helpers (NFR-7).
 *
 * Each tab is read in one getDataRange() call and turned into records keyed by
 * header name. Writes go through appendRecord/updateRecord. Callers that write
 * run inside withLock_() (see Main.gs), so the read → decide → write sequence is
 * atomic across concurrent requests (PRD §8).
 */

function masterTable_() {
  var table = readTable_(openTab_('MASTER_SHEET_ID', TABS.MASTER_STUDENTS));
  var required = [MASTER_COLUMNS.enrollment_no, MASTER_COLUMNS.name, MASTER_COLUMNS.email];
  required.forEach(function (header) {
    if (table.headers.indexOf(header) === -1) {
      throw new Error('Master_Students is missing column "' + header + '" — see MASTER_COLUMNS in Config.gs');
    }
  });
  return table;
}

function aatceTable_(tabName) {
  return readTable_(openTab_('ATTENDANCE_SHEET_ID', tabName));
}

function openTab_(idProperty, tabName) {
  var sheet = SpreadsheetApp.openById(requireProp_(idProperty)).getSheetByName(tabName);
  if (!sheet) throw new Error('Sheet tab "' + tabName + '" not found — run setupSheets()');
  return sheet;
}

/**
 * @returns {{ sheet: Sheet, headers: string[], records: Object[] }}
 *   Each record maps header → cell value, plus `_row` (1-based sheet row).
 *   Date cells are returned as ISO 8601 strings.
 */
function readTable_(sheet) {
  var values = sheet.getDataRange().getValues();
  var headers = values.length ? values[0].map(function (h) { return String(h).trim(); }) : [];
  var records = [];
  for (var r = 1; r < values.length; r++) {
    var record = { _row: r + 1 };
    for (var c = 0; c < headers.length; c++) {
      if (headers[c]) record[headers[c]] = normalizeCell_(values[r][c]);
    }
    records.push(record);
  }
  return { sheet: sheet, headers: headers, records: records };
}

function normalizeCell_(value) {
  return Object.prototype.toString.call(value) === '[object Date]' ? toISO_(value) : value;
}

function findRecord_(table, header, value) {
  var target = String(value).trim();
  for (var i = 0; i < table.records.length; i++) {
    if (String(table.records[i][header]).trim() === target) return table.records[i];
  }
  return null;
}

function appendRecord_(table, record) {
  var row = table.headers.map(function (h) { return record[h] !== undefined ? safeCell_(record[h]) : ''; });
  table.sheet.appendRow(row);
}

function updateRecord_(table, record, changes) {
  Object.keys(changes).forEach(function (header) {
    var col = table.headers.indexOf(header) + 1;
    if (col === 0) throw new Error('Column "' + header + '" not found');
    table.sheet.getRange(record._row, col).setValue(safeCell_(changes[header]));
    record[header] = changes[header];
  });
}

/** Stops user-typed text such as "=IMPORTXML(...)" from being stored as a formula. */
function safeCell_(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
}

/** Runs fn while holding the script-wide lock. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Server busy, please retry');
  }
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

/** Returns a trimmed enrollment number, or null if it is missing or malformed. */
function cleanEnrollmentNo_(value) {
  var s = String(value === undefined || value === null ? '' : value).trim();
  return ENROLLMENT_NO_PATTERN.test(s) ? s : null;
}

function toISO_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** yyyy-MM-dd in the script time zone. Accepts a Date or anything Date() can parse. */
function dateKey_(value) {
  var d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function errorResult_(error, code) {
  return { success: false, error: error, error_code: code };
}
