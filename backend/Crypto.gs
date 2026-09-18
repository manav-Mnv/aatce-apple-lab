/**
 * Crypto.gs — Token generation helpers
 */

/**
 * Generate a URL-safe unique token for enrollment.
 * Format: 8-4-4-4-12 hex (UUID v4-like).
 */
function generateToken() {
  const hex = '0123456789abcdef';
  const segment = (len) => {
    let s = '';
    for (let i = 0; i < len; i++) {
      s += hex[Math.floor(Math.random() * 16)];
    }
    return s;
  };
  return `${segment(8)}-${segment(4)}-${segment(4)}-${segment(4)}-${segment(12)}`;
}

/**
 * Generate a short numeric PIN (6 digits).
 */
function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
