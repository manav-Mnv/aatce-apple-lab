/**
 * Setup.gs — One-time setup, run by the owner from the Apps Script editor.
 *
 *   setupSheets()     creates any missing AATCE tabs with their header rows and
 *                     checks that Master_Students has the columns we read.
 *   installTriggers() schedules closeStaleSessions nightly at 01:00.
 *
 * Both refuse to run unless the caller is the script owner, so they cannot be
 * triggered from the public activity-form page.
 */

function setupSheets() {
  requireOwner_();
  var spreadsheet = SpreadsheetApp.openById(requireProp_('ATTENDANCE_SHEET_ID'));

  Object.keys(HEADERS).forEach(function (tab) {
    var sheet = spreadsheet.getSheetByName(tab) || spreadsheet.insertSheet(tab);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS[tab].length).setValues([HEADERS[tab]]).setFontWeight('bold');
      sheet.setFrozenRows(1);
      console.log('Created headers for ' + tab);
    } else {
      var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      var missing = HEADERS[tab].filter(function (h) { return existing.indexOf(h) === -1; });
      if (missing.length) throw new Error(tab + ' is missing columns: ' + missing.join(', '));
    }
  });

  var master = masterTable_();
  console.log('Master_Students OK: ' + master.records.length + ' rows');
  if (master.headers.indexOf(MASTER_COLUMNS.batch_tags) === -1) {
    console.warn('Master_Students has no "' + MASTER_COLUMNS.batch_tags + '" column — batch filters will be empty');
  }
}

function installTriggers() {
  requireOwner_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'closeStaleSessions') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('closeStaleSessions').timeBased().everyDays(1).atHour(1).create();
  console.log('Nightly closeStaleSessions trigger installed');
}

function requireOwner_() {
  var active = Session.getActiveUser().getEmail();
  if (!active || active !== Session.getEffectiveUser().getEmail()) {
    throw new Error('Run this from the Apps Script editor as the script owner.');
  }
}
