import type { APIRoute } from 'astro';
import { getUserBySession, addPoints } from '../../lib/auth';
import { getReviewEmitter } from '../../lib/onchain';

/**
 * POST /api/reviews
 *
 * Crea una review para un museo/producto/tour. Otorga 5 puntos al autor
 * (múltiplo de 5, configurable via POINTS_PER_REVIEW si querés cambiarlo).
 * Emite un evento on-chain (mock hasta deploy de EdificARteReviews.sol).
 *
 * Body: {
 *   targetType: 'museum' | 'product' | 'tour',
 *   targetId: string,
 *   rating: number (1-5),
 *   text?: string,
 *   walletAddress?: string (opcional — si el user conectó wallet, se incluye en el evento)
 * }
 *
 * Respuesta: { ok: true, reviewId, pointsEarned, totalPoints, txHash, mode }
 */
const POINTS_PER_REVIEW = 5;

interface ReviewPayload {
  targetType?: string;
  targetId?: string;
  rating?: number;
  text?: string;
  walletAddress?: string;
}

const VALID_TARGET_TYPES = new Set(['museum', 'product', 'tour']);

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const env = locals.runtime.env;
  const user = await getUserBySession(cookies, env);

  if (!user) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Necesitás iniciar sesión para dejar una review.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: ReviewPayload;
  try {
    body = (await request.json()) as ReviewPayload;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Body JSON inválido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Validación
  if (!body.targetType || !VALID_TARGET_TYPES.has(body.targetType)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'targetType inválido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (!body.targetId || typeof body.targetId !== 'string') {
    return new Response(
      JSON.stringify({ ok: false, error: 'targetId requerido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return new Response(
      JSON.stringify({ ok: false, error: 'rating debe ser entero entre 1 y 5' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  const text = (body.text ?? '').trim().slice(0, 500); // máx 500 chars

  // Persistir review en D1
  const reviewId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      'INSERT INTO reviews (id, user_id, target_type, target_id, rating, text) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(reviewId, user.id, body.targetType, body.targetId, rating, text || null)
      .run();
  } catch (err) {
    console.error('[api/reviews] insert error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: 'No pudimos guardar la review.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Sumar puntos al autor (múltiplo de 5).
  const totalPoints = await addPoints(env, user.id, POINTS_PER_REVIEW);

  // Emitir evento on-chain (mock si no hay contratos deployados).
  let txHash = '';
  let mode: 'mock' | 'live' = 'mock';
  try {
    const emitter = getReviewEmitter(env);
    const result = await emitter.emitReview({
      toAddress: body.walletAddress ?? '0x0000000000000000000000000000000000000000',
      targetType: body.targetType as 'museum' | 'product' | 'tour',
      targetId: body.targetId,
      rating,
      reviewId,
    });
    txHash = result.txHash;
    mode = result.mode;
    // Guardar tx_hash en la review para trazabilidad.
    if (txHash) {
      await env.DB.prepare('UPDATE reviews SET tx_hash = ? WHERE id = ?')
        .bind(txHash, reviewId)
        .run();
    }
  } catch (err) {
    // No fallamos la review si on-chain falla — off-chain ya quedó persistido.
    console.warn('[api/reviews] on-chain emit falló, review off-chain OK:', err);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      reviewId,
      pointsEarned: POINTS_PER_REVIEW,
      totalPoints,
      txHash,
      mode,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

/**
 * GET /api/reviews?targetType=museum&targetId=bellas-artes
 *
 * Lista las últimas 50 reviews de un target.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;
  const targetType = url.searchParams.get('targetType');
  const targetId = url.searchParams.get('targetId');

  if (!targetType || !VALID_TARGET_TYPES.has(targetType) || !targetId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Parámetros inválidos' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { results } = await env.DB.prepare(
    `SELECT r.id, r.rating, r.text, r.created_at, u.name as author_name, u.avatar_url
     FROM reviews r JOIN users u ON u.id = r.user_id
     WHERE r.target_type = ? AND r.target_id = ?
     ORDER BY r.created_at DESC LIMIT 50`
  )
    .bind(targetType, targetId)
    .all();

  // Promedio de rating
  const avgRow = await env.DB.prepare(
    `SELECT AVG(rating) as avg_rating, COUNT(*) as count
     FROM reviews WHERE target_type = ? AND target_id = ?`
  )
    .bind(targetType, targetId)
    .first<{ avg_rating: number; count: number }>();

  return new Response(
    JSON.stringify({
      ok: true,
      reviews: results ?? [],
      avgRating: Number(avgRow?.avg_rating ?? 0),
      count: Number(avgRow?.count ?? 0),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};