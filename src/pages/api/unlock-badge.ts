import type { APIRoute } from 'astro';
import { getUserBySession, unlockUserBadge } from '../../lib/auth';
import { getBadgeMinter } from '../../lib/onchain';

/**
 * POST /api/unlock-badge
 *
 * Marca un badge como desbloqueado por visita a un monumento.
 * Otorga 5 puntos (múltiplo de 5). Emite un mint NFT on-chain (mock hasta
 * deploy de EdificARteBadge.sol).
 *
 * Body: { badgeId: number, monumentName?: string, monumentImage?: string }
 * Respuesta: { success, pointsEarned, totalPoints?, txHash?, mode? }
 */

const POINTS_PER_VISIT = 5;

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const env = locals.runtime.env;

  // 1. Resolver usuario (registrado o guest)
  const user = await getUserBySession(cookies, env);
  const isGuest = (cookies.get('edificarte_guest')?.value || cookies.get('turimap_guest')?.value) === 'true';

  if (!user && !isGuest) {
    return new Response(
      JSON.stringify({ error: 'Inicia sesión para registrar tu visita y ganar la insignia.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: { badgeId?: number; monumentName?: string; monumentImage?: string; walletAddress?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: 'Body JSON inválido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.badgeId) {
    return new Response(JSON.stringify({ error: 'Falta el badgeId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const badgeId = Number(body.badgeId);

  if (user) {
    // Usuario registrado: persistir en D1 + sumar puntos solo si es nuevo badge + mintear NFT
    const existingBadge = await env.DB.prepare(
      'SELECT 1 FROM user_badges WHERE user_id = ? AND badge_id = ?'
    ).bind(user.id, badgeId).first();
    const isNewBadge = !existingBadge;

    await unlockUserBadge(env, user.id, badgeId);

    let totalPoints = 0;
    if (isNewBadge) {
      const newPoints = await env.DB.prepare(
        'UPDATE users SET points = points + ?, visits = visits + 1 WHERE id = ? RETURNING points'
      )
        .bind(POINTS_PER_VISIT, user.id)
        .first<{ points: number }>();
      totalPoints = newPoints?.points ?? 0;
    } else {
      // Badge ya existia: solo incrementar visits, no puntos
      await env.DB.prepare('UPDATE users SET visits = visits + 1 WHERE id = ?').bind(user.id).run();
      const current = await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(user.id).first<{ points: number }>();
      totalPoints = current?.points ?? 0;
    }

    // Buscar si el usuario tiene una wallet vinculada en user_wallets
    const walletRow = await env.DB.prepare(
      'SELECT address FROM user_wallets WHERE user_id = ? LIMIT 1'
    )
      .bind(user.id)
      .first<{ address: string }>();
    const walletAddress = walletRow?.address ?? body.walletAddress ?? '0x0000000000000000000000000000000000000000';

    // Mint NFT on-chain (mock hasta deploy).
    let txHash: string | undefined;
    let mode: 'mock' | 'live' | undefined;
    try {
      const minter = getBadgeMinter(env);
      const result = await minter.safeMint({
        toAddress: walletAddress,
        badgeId,
        metadata: {
          name: body.monumentName ?? `Badge #${badgeId}`,
          description: `Medalla por visitar ${body.monumentName ?? 'monumento'} en EdificARTE.`,
          image: body.monumentImage ?? '',
          monumentId: String(badgeId),
          visitedAt: new Date().toISOString(),
        },
      });
      txHash = result.txHash;
      mode = result.mode;
      // Guardar tx_hash en user_badges.
      if (txHash) {
        await env.DB.prepare(
          'UPDATE user_badges SET tx_hash = ? WHERE user_id = ? AND badge_id = ?'
        )
          .bind(txHash, user.id, badgeId)
          .run();
      }
    } catch (err) {
      console.warn('[api/unlock-badge] on-chain mint falló, badge off-chain OK:', err);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: '¡Insignia desbloqueada!',
        pointsEarned: POINTS_PER_VISIT,
        totalPoints,
        txHash,
        mode,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } else {
    // Guest: responder éxito especial para que el cliente guarde en localStorage.
    return new Response(
      JSON.stringify({
        success: true,
        isGuest: true,
        badgeId,
        pointsEarned: POINTS_PER_VISIT,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
};