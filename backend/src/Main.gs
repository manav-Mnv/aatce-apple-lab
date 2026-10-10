/**
 * Main.gs — Web app entry points.
 *
 * API: every call is a POST with a JSON body { secret, action, ...params }.
 * The secret decides the caller's role and the actions it may use (Auth.gs).
 * Write actions run under the script lock from read to write.
 *
 * GET is only used for the student-facing activity form link (?session=<id>)
 * sent by email; no API action is reachable over GET.
 */

var API_VERSION = '2.1.0';

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e && e.postData ? e.postData.contents : '');
  } catch (err) {
    return jsonResponse_(errorResult_('Invalid JSON body', 'invalid_json'));
  }
  if (!body || typeof body !== 'object') {
    return jsonResponse_(errorResult_('JSON body must be an object', 'invalid_json'));
  }
  return jsonResponse_(route_(body));
}

function doGet(e) {
  var session = e && e.parameter ? e.parameter.session : '';
  if (session) {
    return renderActivityForm_(String(session));
  }
  return jsonResponse_(errorResult_('GET is not supported. Use POST with a JSON body.', 'method_not_allowed'));
}

function route_(body) {
  try {
    var auth = authenticate_(body);
    if (!auth.role) return errorResult_(auth.error, auth.error_code);

    var action = String(body.action || '');
    var handler = handlerFor_(action);
    if (!handler) return errorResult_('Unknown action: ' + action, 'unknown_action');
    if (!isAllowed_(auth.role, action)) {
      return errorResult_('Action "' + action + '" is not allowed for this client', 'forbidden');
    }

    if (WRITE_ACTIONS.indexOf(action) !== -1) {
      return withLock_(function () { return handler(body); });
    }
    return handler(body);
  } catch (err) {
    return errorResult_('Internal server error: ' + err.message, 'server_error');
  }
}

function handlerFor_(action) {
  switch (action) {
    case 'status': return handleStatus_;
    case 'lookup': return handleLookup_;
    case 'enroll': return handleEnroll_;
    case 'upload_faces': return handleUploadFaces_;
    case 'scan': return handleScan_;
    case 'embeddings_version': return handleEmbeddingsVersion_;
    case 'embeddings_download': return handleEmbeddingsDownload_;
    case 'face_manifest': return handleFaceManifest_;
    case 'face_images': return handleFaceImages_;
    case 'publish_embeddings': return handlePublishEmbeddings_;
    case 'dashboard': return handleDashboard_;
    case 'occupancy': return handleOccupancy_;
    case 'attendance_log': return handleAttendanceLog_;
    case 'students': return handleStudents_;
    case 'workshop_attendees': return handleWorkshopAttendees_;
    default: return null;
  }
}

function handleStatus_() {
  return { success: true, status: 'online', timestamp: toISO_(new Date()), version: API_VERSION };
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
