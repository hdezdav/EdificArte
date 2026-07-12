import type { APIRoute } from 'astro';

/**
 * POST /api/exit-guest
 *
 * Limpia las cookies de invitado para que /yo muestre el formulario de
 * login/registro en lugar del panel de guest.
 *
 * Por qué existe: el botón "Registrarse ahora" en src/pages/yo.astro
 * intenta borrar la cookie desde JS, pero ahora son httpOnly:false igual
 * este endpoint es más confiable — server-side es la fuente de verdad.
 *
 * Respuesta: { ok: true }
 */
export const POST: APIRoute = async ({ cookies }) => {
  cookies.delete('edificarte_guest', { path: '/' });
  cookies.delete('edificarte_guest_name', { path: '/' });
  return new Response(
    JSON.stringify({ ok: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
