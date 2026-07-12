import type { APIRoute } from 'astro';

/**
 * POST /api/welcome
 *
 * Setea las cookies de invitado (guest + guest_name) desde el server-side.
 *
 * Por qué server-side: el cliente no puede escribir cookies httpOnly (y aunque
 * las hagamos no-httpOnly para que el modal del index pueda leerlas, sigue
 * siendo más limpio que el server sea la fuente de verdad). El modal de
 * bienvenida en src/pages/index.astro llama a este endpoint en vez de hacer
 * document.cookie directo.
 *
 * Body: { name: string }
 * Respuesta: { ok: true, name: string }
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const body = (await request.json()) as { name?: string };
    const name = (body.name ?? '').trim();

    if (!name || name.length < 2 || name.length > 60) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Nombre inválido (2-60 caracteres).' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Marcar como guest activo. httpOnly:false intencional — ver nota en
    // src/pages/yo.astro línea ~118.
    cookies.set('edificarte_guest', 'true', {
      path: '/',
      httpOnly: false,
      secure: import.meta.env.PROD,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 año
    });

    // Nombre del invitado para pre-rellenar el formulario de registro en /yo.
    // También httpOnly:false para que el cliente pueda leerlo si lo necesita
    // (ej. mostrar el nombre en el header). No es dato sensible.
    cookies.set('edificarte_guest_name', name, {
      path: '/',
      httpOnly: false,
      secure: import.meta.env.PROD,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });

    return new Response(
      JSON.stringify({ ok: true, name }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[api/welcome] error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: 'Error interno' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
