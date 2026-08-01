import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/admin';

export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;

  if (!(isAdmin(locals))) {
    return new Response(JSON.stringify({ ok: false, error: 'No autenticado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20'));
    const targetType = url.searchParams.get('targetType') || '';
    const offset = (page - 1) * limit;

    let query = `SELECT r.id, r.user_id, r.target_type, r.target_id, r.rating, r.text, r.tx_hash, r.created_at, u.name as author_name, u.email as author_email
      FROM reviews r LEFT JOIN users u ON u.id = r.user_id`;
    let countQuery = 'SELECT COUNT(*) as count FROM reviews';
    const binds: unknown[] = [];

    if (targetType) {
      query += ' WHERE r.target_type = ?';
      countQuery += ' WHERE target_type = ?';
      binds.push(targetType);
    }

    query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';

    const countResult = await env.DB.prepare(countQuery).bind(...binds).first<{ count: number }>();
    const { results } = await env.DB.prepare(query).bind(...binds, limit, offset).all();

    return new Response(
      JSON.stringify({
        ok: true,
        reviews: results ?? [],
        total: countResult?.count ?? 0,
        page,
        limit,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[admin/reviews GET]', err);
    return new Response(JSON.stringify({ ok: false, error: 'Error interno' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;

  if (!(isAdmin(locals))) {
    return new Response(JSON.stringify({ ok: false, error: 'No autenticado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const reviewId = url.searchParams.get('id');
    if (!reviewId) {
      return new Response(JSON.stringify({ ok: false, error: 'id requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await env.DB.prepare('DELETE FROM reviews WHERE id = ?').bind(reviewId).run();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[admin/reviews DELETE]', err);
    return new Response(JSON.stringify({ ok: false, error: 'Error interno' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};