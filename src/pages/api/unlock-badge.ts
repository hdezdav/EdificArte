import type { APIRoute } from 'astro';
import { getUserBySession, unlockUserBadge } from '../../lib/auth';

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const env = locals.runtime.env;

  // 1. Intentar obtener usuario actual
  const user = await getUserBySession(cookies, env);
  
  // 2. Si no hay usuario, verificar si tiene cookie de invitado activa
  const isGuest = cookies.get('edificarte_guest')?.value === 'true';

  if (!user && !isGuest) {
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

    if (user) {
      // Registrar logro en la base de datos D1 para el usuario registrado
      await unlockUserBadge(env, user.id, Number(badgeId));
      await env.DB.prepare('UPDATE users SET points = points + 100, visits = visits + 1 WHERE id = ?')
        .bind(user.id)
        .run();

      return new Response(JSON.stringify({ success: true, message: '¡Insignia desbloqueada!' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      // Responder éxito especial para invitados (se guarda en localStorage del lado del cliente)
      return new Response(JSON.stringify({ success: true, isGuest: true, badgeId: Number(badgeId) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
