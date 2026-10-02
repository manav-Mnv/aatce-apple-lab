/**
 * Auth.gs — Shared-secret authentication via JSON body (NFR-4, FR-13).
 *
 * Every endpoint must call validateSecret() before processing.
 * The secret is stored in Script Properties (NFR-8), never in code.
 *
 * IMPORTANT: Google Apps Script web apps (doPost/doGet) do NOT expose custom
 * HTTP headers via the event object. Therefore, X-Shared-Secret header
 * auth is impossible. All requests must be sent as POST requests with the
 * secret embedded in the JSON body: `{ "secret": "<YOUR_SECRET>", "action": "..." }`.
 */

/**
 * Validates the shared secret from the request body.
 *
 * @param {GoogleAppsScript.Events.DoPost} e - The event object.
 * @returns {{ valid: boolean, error?: string, error_code?: string }}
 */
function validateSecret(e) {
  var secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');

  if (!secret) {
    return {
      valid: false,
      error: 'Server misconfiguration: shared secret not set',
      error_code: 'auth_misconfigured'
    };
  }

  var provided = null;

  // Extract secret from POST body
  if (e && e.postData && e.postData.contents) {
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
    return {
      valid: false,
      error: 'Missing authentication: include "secret" in JSON body',
      error_code: 'auth_missing'
    };
  }

  if (provided !== secret) {
    return {
      valid: false,
      error: 'Invalid authentication secret',
      error_code: 'auth_invalid'
    };
  }

  return { valid: true };
}
