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
    const search = url.searchParams.get('search')?.trim() || '';
    const offset = (page - 1) * limit;

    let query = 'SELECT id, name, email, points, likes, visits, phone, created_at FROM users';
    let countQuery = 'SELECT COUNT(*) as count FROM users';
    const binds: unknown[] = [];

    if (search) {
      const where = ' WHERE name LIKE ? OR email LIKE ?';
      query += where;
      countQuery += where;
      binds.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

    const countResult = await env.DB.prepare(countQuery).bind(...binds).first<{ count: number }>();
    const { results } = await env.DB.prepare(query).bind(...binds, limit, offset).all();

    return new Response(
      JSON.stringify({
        ok: true,
        users: results ?? [],
        total: countResult?.count ?? 0,
        page,
        limit,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[admin/users]', err);
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
    const body = (await request.json()) as { id?: string; name?: string; email?: string; points?: number; phone?: string };
    if (!body.id) {
      return new Response(JSON.stringify({ ok: false, error: 'id requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
    if (body.email !== undefined) { fields.push('email = ?'); values.push(body.email); }
    if (body.points !== undefined) { fields.push('points = ?'); values.push(body.points); }
    if (body.phone !== undefined) { fields.push('phone = ?'); values.push(body.phone); }

    if (fields.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Nothing to update' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    values.push(body.id);
    await env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[admin/users PATCH]', err);
    return new Response(JSON.stringify({ ok: false, error: 'Error interno' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};