/**
 * Code.gs — doPost entry point
 *
 * Routes incoming POST requests to the correct handler after
 * verifying the shared secret in the X-API-Secret header.
 */

function doPost(e) {
  try {
    // --- Parse body ---
    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (_) {
      return jsonResponse_(400, { error: 'Invalid JSON body' });
    }

    // --- Auth: shared secret ---
    const secret = e.parameter?.secret
      || e.parameter?.API_SECRET
      || '';
    const headerSecret = e.headers?.['x-api-secret']
      || e.headers?.['X-API-Secret']
      || '';

    const provided = secret || headerSecret;
    const stored = PropertiesService.getScriptProperties().getProperty(CONFIG.SECRET_KEY);

    if (!stored) {
      return jsonResponse_(500, {
        error: 'Server misconfigured — API_SHARED_SECRET not set in Script Properties',
      });
    }

    if (provided !== stored) {
      return jsonResponse_(401, { error: 'Unauthorized — invalid or missing shared secret' });
    }

    // --- Route ---
    const route = (payload.route || e.parameter?.route || '').toLowerCase();

    let result;
    switch (route) {
      case 'enroll':
        result = handleEnroll(payload);
        break;
      case 'scan':
        result = handleScan(payload);
        break;
      default:
        return jsonResponse_(400, {
          error: `Unknown route: "${route}". Valid routes: enroll, scan`,
        });
    }

    return jsonResponse_(200, result);
  } catch (err) {
    return jsonResponse_(500, { error: err.message || String(err) });
  }
}

/**
 * Lightweight GET for health checks / deploy verification.
 */
function doGet(e) {
  return jsonResponse_(200, { status: 'ok', timestamp: new Date().toISOString() });
}

/**
 * Helper — return a JSON ContentService response.
 */
function jsonResponse_(code, body) {
  const output = ContentService.createTextOutput(JSON.stringify(body));
  output.setMimeType(ContentService.MimeType.JSON);
  // ContentService doesn't support setting HTTP status codes directly,
  // but the body always includes what happened. Clients should check
  // the `success` field or presence of `error`.
  return output;
}
