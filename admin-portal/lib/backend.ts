import 'server-only';

/**
 * Server-side calls to the Apps Script backend with the admin secret (FR-20).
 * The secret never reaches the browser: only Route Handlers import this file.
 */
export class BackendError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function callBackend<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.ADMIN_SECRET;
  if (!url || !secret) throw new BackendError('not_configured', 'APPS_SCRIPT_URL and ADMIN_SECRET must be set');

  // Apps Script answers POST with a 302 that must be fetched with GET; fetch does that.
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, secret, action }),
    cache: 'no-store'
  });
  const text = await response.text();
  let body: { success?: boolean; error?: string; error_code?: string } & T;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BackendError('bad_response', `Backend did not return JSON (HTTP ${response.status})`);
  }
  if (!body.success) throw new BackendError(body.error_code || 'unknown', body.error || 'Backend error');
  return body;
}
