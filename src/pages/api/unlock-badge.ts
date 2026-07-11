import type { APIRoute } from 'astro';
import { getUserBySession, unlockUserBadge } from '../../lib/auth';

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const env = locals.runtime.env;

  // 1. Obtener usuario actual
  const user = await getUserBySession(cookies, env);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Inicia sesión para registrar tu visita y ganar la insignia.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { badgeId } = await request.json();
    if (!badgeId) {
      return new Response(JSON.stringify({ error: 'Falta el badgeId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Desbloquear insignia para el usuario
    await unlockUserBadge(env, user.id, Number(badgeId));
    
    // 3. Sumarle 100 puntos y 1 visita en la base de datos
    await env.DB.prepare('UPDATE users SET points = points + 100, visits = visits + 1 WHERE id = ?')
      .bind(user.id)
      .run();

    return new Response(JSON.stringify({ success: true, message: '¡Insignia desbloqueada!' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
