import type { AstroCookies } from 'astro';
import type { User } from './auth';

export function isAdmin(locals: Pick<App.Locals, 'adminAuthorized'>): boolean {
  return locals.adminAuthorized;
}

export const createRequestId = () => crypto.randomUUID();

export function adminEmail(locals: Pick<App.Locals, 'user'>): string {
  return locals.user?.email || 'admin@turimap.app';
}

export function validateSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (!origin || forwardedProto?.includes(',') || forwardedHost?.includes(','))
    return false;
  try {
    const requestUrl = new URL(request.url);
    const expected = new URL(
      `${forwardedProto || requestUrl.protocol.replace(':', '')}://${forwardedHost || requestUrl.host}`
    );
    const supplied = new URL(origin);
    return supplied.origin === origin && supplied.origin === expected.origin;
  } catch {
    return false;
  }
}

type CsrfCookies = Pick<AstroCookies, 'get' | 'set' | 'delete'>;

export async function verifyAdminAccess(env: Env, cookies: CsrfCookies) {
  const sessionId = cookies.get('turimap_admin_session')?.value;
  if (!sessionId) {
    return { user: null, sessionId: null, authorized: false };
  }
  try {
    const sessionDataStr = await env.SESSION.get(`admin_session_${sessionId}`);
    if (!sessionDataStr) {
      return { user: null, sessionId: null, authorized: false };
    }
    const session = JSON.parse(sessionDataStr) as { userId?: string; email?: string; role?: string };
    if (session.role !== 'admin') {
      return { user: null, sessionId: null, authorized: false };
    }
    const adminUser: User = {
      id: session.userId || 'admin',
      email: session.email || 'admin@turimap.app',
      name: 'Admin',
      avatar_url: null,
      bio: null,
      points: 0,
      likes: 0,
      visits: 0,
      phone: null,
      created_at: new Date().toISOString(),
    };
    return { user: adminUser, sessionId, authorized: true };
  } catch {
    return { user: null, sessionId: null, authorized: false };
  }
}

export async function resolveAdminRequestContext(
  env: Env,
  cookies: CsrfCookies,
  secure: boolean
) {
  const { user, sessionId, authorized } = await verifyAdminAccess(env, cookies);
  const token = cookies.get('turimap_admin_csrf')?.value;
  const binding = cookies.get('turimap_admin_csrf_session')?.value;
  const options = {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 8,
  };
  let csrfToken = authorized && binding === sessionId ? token || null : null;
  if (authorized && !csrfToken) {
    csrfToken = crypto.randomUUID();
    cookies.set('turimap_admin_csrf', csrfToken, options);
    cookies.set('turimap_admin_csrf_session', sessionId!, options);
  } else if (!authorized && (token || binding)) {
    cookies.delete('turimap_admin_csrf', { path: '/' });
    cookies.delete('turimap_admin_csrf_session', { path: '/' });
  }
  return { user, sessionId, authorized, csrfToken };
}

export function validateCsrf(
  request: Request,
  expected: string | null
): boolean {
  const supplied = request.headers.get('x-csrf-token');
  return Boolean(
    expected &&
    supplied &&
    expected.length === supplied.length &&
    expected === supplied
  );
}
