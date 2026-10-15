import 'server-only';

/**
 * Server-side calls to the Supabase backend with the admin secret (FR-20).
 * POST <SUPABASE_URL>/rest/v1/rpc/api with { secret, action, ...params } and the
 * publishable key in `apikey`. Only server code imports this file, so the admin
 * secret never reaches the browser.
 */
export class BackendError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function callBackend<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.ADMIN_SECRET;
  if (!url || !key || !secret) {
    throw new BackendError('not_configured', 'SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and ADMIN_SECRET must be set');
  }

  const response = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
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
  if (!response.ok) throw new BackendError(`http_${response.status}`, text.slice(0, 200));
  if (!body.success) throw new BackendError(body.error_code || 'unknown', body.error || 'Backend error');
  return body;
}
