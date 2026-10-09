/**
 * Auth.gs — Per-role shared-secret authentication (FR-13, NFR-4).
 *
 * Apps Script web apps cannot read custom HTTP headers, so every request is a
 * POST whose JSON body carries `secret`. Each client type (kiosk, ML pipeline,
 * admin portal) has its own secret, and each role may call only its own
 * actions (ROLE_ACTIONS). Leaking the kiosk secret therefore does not expose
 * the roster or let anyone replace the embeddings file.
 */

/**
 * Resolves the caller's role from the body secret.
 * @param {Object} body - Parsed JSON body.
 * @returns {{ role?: string, error?: string, error_code?: string }}
 */
function authenticate_(body) {
  var roles = Object.keys(ROLE_SECRET_PROPERTY);
  var configured = roles.filter(function (role) { return getProp_(ROLE_SECRET_PROPERTY[role]); });

  if (configured.length === 0) {
    return { error: 'Server misconfiguration: no secrets set', error_code: 'auth_misconfigured' };
  }

  var provided = body && typeof body.secret === 'string' ? body.secret : '';
  if (!provided) {
    return { error: 'Missing authentication: include "secret" in JSON body', error_code: 'auth_missing' };
  }

  for (var i = 0; i < configured.length; i++) {
    if (constantTimeEquals_(provided, getProp_(ROLE_SECRET_PROPERTY[configured[i]]))) {
      return { role: configured[i] };
    }
  }
  return { error: 'Invalid authentication secret', error_code: 'auth_invalid' };
}

/** True if `role` may call `action`. */
function isAllowed_(role, action) {
  return (ROLE_ACTIONS[role] || []).indexOf(action) !== -1;
}

/** String comparison whose duration does not depend on where the strings differ. */
function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
