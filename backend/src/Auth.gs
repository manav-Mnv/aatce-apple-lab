/**
 * Auth.gs — Shared-secret authentication via X-Shared-Secret header (NFR-4, FR-13).
 *
 * Every endpoint must call validateSecret() before processing.
 * The secret is stored in Script Properties (NFR-8), never in code.
 *
 * IMPORTANT — Apps Script web app limitation:
 * Google Apps Script web apps (doPost/doGet) do NOT expose custom request
 * headers via the event object. The `e` parameter only provides `parameter`,
 * `postData`, `queryString`, etc. — no `headers` property.
 *
 * Workaround: Until the backend is fronted by a proxy that can forward
 * headers as parameters, the secret is accepted via:
 *   1. X-Shared-Secret header (preferred — works in testing and if proxied)
 *   2. POST body field "secret" (Apps Script workaround for deployed web app)
 *
 * The API contract documents header-based auth as the canonical method.
 * Callers should always send the header; the body fallback exists only
 * because of the Apps Script platform limitation.
 */

/**
 * Validates the shared secret from the request.
 * Checks X-Shared-Secret header first, then falls back to body field
 * (Apps Script workaround — see module comment above).
 *
 * @param {GoogleAppsScript.Events.DoPost|GoogleAppsScript.Events.DoGet} e - The event object.
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

  // 1. Check X-Shared-Secret header (preferred method)
  //    Available when proxied or in test environments.
  if (e && e.headers) {
    provided = e.headers['X-Shared-Secret'] || e.headers['x-shared-secret'] || null;
  }

  // 2. Fallback: check POST body "secret" field (Apps Script workaround)
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
    return {
      valid: false,
      error: 'Missing authentication: send X-Shared-Secret header',
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
