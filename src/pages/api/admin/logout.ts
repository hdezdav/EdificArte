import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/admin';

export const POST: APIRoute = async ({ cookies, locals }) => {
  if (!isAdmin(locals)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'No autenticado' }),
      { status: 401 }
    );
  }
  const sessionId = cookies.get('turimap_admin_session')?.value;
  if (sessionId) {
    await locals.runtime.env.SESSION.delete(`admin_session_${sessionId}`);
  }
  cookies.delete('turimap_admin_session', { path: '/' });
  cookies.delete('turimap_admin_csrf', { path: '/' });
  cookies.delete('turimap_admin_csrf_session', { path: '/' });
  return new Response(
    JSON.stringify({ ok: true }),
    { status: 200 }
  );
};
