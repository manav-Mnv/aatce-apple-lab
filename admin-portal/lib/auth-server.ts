import 'server-only';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { isAllowedEmail } from './access';

/**
 * Verifies the Firebase ID token sent by the browser (FR-18, NFR-4).
 *
 * Firebase ID tokens are JWTs signed by Google; verifying them needs only the
 * public keys below — no service account. Access is granted to verified emails
 * in NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN or ADMIN_EMAILS; with neither set, nobody.
 *
 * Without Firebase configured, requests are allowed only in development
 * (`next dev`); a production build refuses everything until it is configured.
 */
const GOOGLE_KEYS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireAdmin(request: Request): Promise<string> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    if (process.env.NODE_ENV !== 'production') return 'dev@localhost';
    throw new AuthError(500, 'Sign-in is not configured (NEXT_PUBLIC_FIREBASE_PROJECT_ID)');
  }

  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) throw new AuthError(401, 'Not signed in');

  let payload;
  try {
    ({ payload } = await jwtVerify(token, GOOGLE_KEYS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId
    }));
  } catch {
    throw new AuthError(401, 'Session expired. Please sign in again.');
  }

  const email = typeof payload.email === 'string' ? payload.email : '';
  if (!email || payload.email_verified !== true) throw new AuthError(403, 'Email not verified');
  if (!isAllowedEmail(email, process.env.NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN, process.env.ADMIN_EMAILS)) {
    throw new AuthError(403, `${email} is not allowed to use the admin portal`);
  }
  return email;
}
