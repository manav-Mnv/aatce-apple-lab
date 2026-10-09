/**
 * Activity.gs — Activity form and email (FR-14, FR-15).
 *
 * On exit (sessions ≥ ACTIVITY_EMAIL_MIN_MINUTES) the student gets an email
 * with a link to this web app: GET ?session=<session_id>. The page posts back
 * through google.script.run.submitActivity, which writes the answer into the
 * same Attendance_Log row. The session_id is a random UUID, so the link itself
 * is the credential for that one row.
 *
 * closeStaleSessions runs nightly (installTriggers in Setup.gs): sessions from
 * earlier days that never got an exit scan are marked NO_EXIT_NOTE and still
 * get the activity email.
 */

var SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function renderActivityForm_(sessionId) {
  var session = SESSION_ID_PATTERN.test(sessionId)
    ? findRecord_(aatceTable_(TABS.ATTENDANCE_LOG), 'session_id', sessionId)
    : null;

  var template = HtmlService.createTemplateFromFile('ActivityForm');
  template.state = !session ? 'invalid' : session.activity_form_status === 'completed' ? 'done' : 'form';
  template.sessionId = session ? String(session.session_id) : '';
  template.sessionDate = session ? Utilities.formatDate(new Date(session.entry_time), Session.getScriptTimeZone(), 'EEEE, d MMMM') : '';
  template.durationMins = session && session.duration_mins !== '' ? String(session.duration_mins) : '';

  return template.evaluate()
    .setTitle('Apple Lab — What did you work on?')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called from ActivityForm.html. Public on purpose; validates everything itself. */
function submitActivity(sessionId, text) {
  var description = String(text || '').trim();
  if (!description) throw new Error('Please describe what you worked on.');
  if (description.length > MAX_ACTIVITY_CHARS) {
    throw new Error('Please keep it under ' + MAX_ACTIVITY_CHARS + ' characters.');
  }
  if (!SESSION_ID_PATTERN.test(String(sessionId))) throw new Error('This link is not valid.');

  return withLock_(function () {
    var log = aatceTable_(TABS.ATTENDANCE_LOG);
    var session = findRecord_(log, 'session_id', String(sessionId));
    if (!session) throw new Error('This link is not valid.');
    if (session.activity_form_status === 'completed') return 'already_submitted';
    updateRecord_(log, session, { activity_description: description, activity_form_status: 'completed' });
    return 'saved';
  });
}

/** Nightly trigger. Idempotent: each stale session is processed once. */
function closeStaleSessions() {
  withLock_(function () {
    var log = aatceTable_(TABS.ATTENDANCE_LOG);
    var master = masterTable_();
    var today = dateKey_(new Date());

    log.records.forEach(function (session) {
      var day = dateKey_(session.entry_time);
      var notes = String(session.notes || '');
      if (session.exit_time || !day || day >= today || notes.indexOf(NO_EXIT_NOTE) !== -1) return;

      var member = findRecord_(master, MASTER_COLUMNS.enrollment_no, session.enrollment_no);
      var changes = { notes: notes ? notes + '; ' + NO_EXIT_NOTE : NO_EXIT_NOTE };
      if (member && session.email_sent !== 'yes') {
        changes.email_sent = sendActivityEmail_(session, memberIdentity_(member), null) ? 'yes' : 'failed';
      }
      updateRecord_(log, session, changes);
    });
  });
}

/** @returns {boolean} true if the email was handed to MailApp. */
function sendActivityEmail_(session, person, durationMins) {
  if (!isEmail_(person.email)) return false;
  try {
    var link = ScriptApp.getService().getUrl() + '?session=' + encodeURIComponent(session.session_id);
    MailApp.sendEmail({
      to: person.email,
      name: 'AATCE Apple Lab',
      subject: 'What did you work on in the Apple Lab?',
      htmlBody: activityEmailHtml_(person.name, link, durationMins)
    });
    return true;
  } catch (err) {
    console.error('Activity email failed for session ' + session.session_id + ': ' + err.message);
    return false;
  }
}

function activityEmailHtml_(name, link, durationMins) {
  var firstName = escapeHtml_(String(name || '').split(' ')[0] || 'there');
  var summary = durationMins === null
    ? 'You checked in to the Apple Lab but we didn\'t see you check out.'
    : 'Thanks for spending ' + durationMins + ' minutes in the Apple Lab today.';
  return '' +
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Helvetica Neue\',Arial,sans-serif;' +
    'max-width:480px;margin:0 auto;padding:32px 24px;color:#1d1d1f">' +
    '<p style="font-size:13px;color:#86868b;margin:0 0 24px">AATCE Apple Lab</p>' +
    '<h1 style="font-size:28px;font-weight:600;letter-spacing:-0.02em;margin:0 0 12px">Hi ' + firstName + '.</h1>' +
    '<p style="font-size:17px;line-height:1.5;margin:0 0 28px">' + summary +
    ' Take ten seconds to note what you worked on.</p>' +
    '<a href="' + escapeHtml_(link) + '" style="display:inline-block;background:#0071e3;color:#fff;' +
    'text-decoration:none;font-size:17px;padding:12px 22px;border-radius:980px">Log my activity</a>' +
    '<p style="font-size:12px;color:#86868b;margin:32px 0 0">Swift Coding Club · Parul University</p>' +
    '</div>';
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
