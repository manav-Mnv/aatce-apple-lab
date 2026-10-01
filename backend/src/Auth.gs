/**
 * Auth.gs — Shared-secret authentication (NFR-4, FR-13).
 *
 * Every endpoint must call validateSecret() before processing.
 * The secret is stored in Script Properties (NFR-8), never in code.
 */

/**
 * Validates the shared secret from the request.
 * @param {GoogleAppsScript.Events.DoPost|GoogleAppsScript.Events.DoGet} e - The event object.
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSecret(e) {
  var secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');

  if (!secret) {
    return { valid: false, error: 'Server misconfiguration: shared secret not set' };
  }

  // Apps Script receives custom headers via the parameter object.
  // For web app deployments, headers aren't directly accessible in doPost/doGet,
  // so we accept the secret as a query parameter or in the JSON body as a fallback.
  var provided = null;

  // Check query parameter first
  if (e && e.parameter && e.parameter.secret) {
    provided = e.parameter.secret;
  }

  // Check JSON body (for POST requests)
  if (!provided && e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      if (body.secret) {
        provided = body.secret;
      }
    } catch (err) {
      // Not JSON — that's fine, will fail auth below
    }
  }

  if (!provided) {
    return { valid: false, error: 'Missing authentication secret' };
  }

  if (provided !== secret) {
    return { valid: false, error: 'Invalid authentication secret' };
  }

  return { valid: true };
}

/**
 * Creates a standardized error response for auth failures.
 * @param {string} message - Error message.
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function authErrorResponse(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
