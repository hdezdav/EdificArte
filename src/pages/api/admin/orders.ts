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
    const status = url.searchParams.get('status') || '';
    const offset = (page - 1) * limit;

    let query = 'SELECT id, user_id, wallet_address, tx_hash, total_usdc, items_json, status, created_at FROM orders';
    let countQuery = 'SELECT COUNT(*) as count FROM orders';
    const binds: unknown[] = [];

    if (status) {
      query += ' WHERE status = ?';
      countQuery += ' WHERE status = ?';
      binds.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

    const countResult = await env.DB.prepare(countQuery).bind(...binds).first<{ count: number }>();
    const { results } = await env.DB.prepare(query).bind(...binds, limit, offset).all();

    return new Response(
      JSON.stringify({
        ok: true,
        orders: results ?? [],
        total: countResult?.count ?? 0,
        page,
        limit,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[admin/orders]', err);
    return new Response(JSON.stringify({ ok: false, error: 'Error interno' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  if (!(isAdmin(locals))) {
    return new Response(JSON.stringify({ ok: false, error: 'No autenticado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as { id?: string; status?: string };
    if (!body.id || !body.status) {
      return new Response(JSON.stringify({ ok: false, error: 'id y status requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const validStatuses = ['paid', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(body.status)) {
      return new Response(JSON.stringify({ ok: false, error: 'Status inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(body.status, body.id).run();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[admin/orders PATCH]', err);
    return new Response(JSON.stringify({ ok: false, error: 'Error interno' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};