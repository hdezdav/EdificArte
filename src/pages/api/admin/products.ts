import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/admin';

interface ProductRow {
  id: string;
  name: string;
  description: string;
  sku: string;
  price: number;
  currency: string;
  category: string;
  origin: string;
  country_code?: string;
  images: string; // JSON array
  file: string;
  is_published: number;
  created_at: string;
}

interface ProductBody {
  id?: string;
  name?: string;
  description?: string;
  sku?: string;
  price?: number;
  currency?: string;
  category?: string;
  origin?: string;
  countryCode?: string;
  images?: string[];
  file?: string;
  is_published?: boolean;
}

function parseProduct(r: ProductRow) {
  let images: string[] = [];
  try {
    images = JSON.parse(r.images || '[]');
  } catch {
    images = [];
  }
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    sku: r.sku,
    price: r.price,
    currency: r.currency,
    category: r.category,
    origin: r.origin,
    countryCode: normalizeCountry(r.country_code) || normalizeCountry(r.origin),
    images,
    file: r.file,
    is_published: !!r.is_published,
    created_at: r.created_at,
  };
}

function normalizeCountry(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[a-zA-Z]{2}$/.test(value.trim())) return null;
  return value.trim().toUpperCase();
}

function json(res: unknown, status = 200): Response {
  return new Response(JSON.stringify(res), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;
  if (!(isAdmin(locals))) {
    return json({ ok: false, error: 'No autenticado' }, 401);
  }

  try {
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '20'));
    const search = url.searchParams.get('search')?.trim() || '';
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM products';
    let countQuery = 'SELECT COUNT(*) as count FROM products';
    const binds: unknown[] = [];

    if (search) {
      const where = ' WHERE name LIKE ? OR sku LIKE ? OR category LIKE ?';
      query += where;
      countQuery += where;
      binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

    const countResult = await env.DB.prepare(countQuery).bind(...binds).first<{ count: number }>();
    const { results } = await env.DB.prepare(query).bind(...binds, limit, offset).all();

    return json({
      ok: true,
      products: ((results ?? []) as unknown as ProductRow[]).map(parseProduct),
      total: countResult?.count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    console.error('[admin/products GET]', err);
    return json({ ok: false, error: 'Error interno' }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(isAdmin(locals))) {
    return json({ ok: false, error: 'No autenticado' }, 401);
  }

  try {
    const body = (await request.json()) as ProductBody;
    if (!body.name) {
      return json({ ok: false, error: 'name requerido' }, 400);
    }

    const id = crypto.randomUUID();
    const countryCode = normalizeCountry(body.countryCode ?? body.origin);
    if (body.countryCode !== undefined && !countryCode) return json({ ok: false, error: 'countryCode must be ISO alpha-2' }, 400);
    await env.DB.prepare(
      'INSERT INTO products (id, name, description, sku, price, currency, category, origin, country_code, images, file, is_published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id,
      body.name,
      body.description ?? '',
      body.sku ?? '',
      body.price ?? 0,
      body.currency ?? 'MXN',
      body.category ?? '',
      body.origin ?? '',
      countryCode,
      JSON.stringify(body.images ?? []),
      body.file ?? '',
      body.is_published === false ? 0 : 1
    ).run();

    return json({ ok: true, id });
  } catch (err) {
    console.error('[admin/products POST]', err);
    return json({ ok: false, error: 'Error interno' }, 500);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(isAdmin(locals))) {
    return json({ ok: false, error: 'No autenticado' }, 401);
  }

  try {
    const body = (await request.json()) as ProductBody;
    if (!body.id) {
      return json({ ok: false, error: 'id requerido' }, 400);
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
    if (body.description !== undefined) { fields.push('description = ?'); values.push(body.description); }
    if (body.sku !== undefined) { fields.push('sku = ?'); values.push(body.sku); }
    if (body.price !== undefined) { fields.push('price = ?'); values.push(body.price); }
    if (body.currency !== undefined) { fields.push('currency = ?'); values.push(body.currency); }
    if (body.category !== undefined) { fields.push('category = ?'); values.push(body.category); }
    if (body.origin !== undefined) { fields.push('origin = ?'); values.push(body.origin); }
    if (body.countryCode !== undefined) {
      const countryCode = normalizeCountry(body.countryCode);
      if (!countryCode) return json({ ok: false, error: 'countryCode must be ISO alpha-2' }, 400);
      fields.push('country_code = ?'); values.push(countryCode);
    } else if (body.origin !== undefined) {
      const countryCode = normalizeCountry(body.origin);
      if (countryCode) { fields.push('country_code = ?'); values.push(countryCode); }
    }
    if (body.images !== undefined) { fields.push('images = ?'); values.push(JSON.stringify(body.images)); }
    if (body.file !== undefined) { fields.push('file = ?'); values.push(body.file); }
    if (body.is_published !== undefined) { fields.push('is_published = ?'); values.push(body.is_published ? 1 : 0); }

    if (fields.length === 0) {
      return json({ ok: false, error: 'Nada que actualizar' }, 400);
    }

    values.push(body.id);
    await env.DB.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

    return json({ ok: true });
  } catch (err) {
    console.error('[admin/products PATCH]', err);
    return json({ ok: false, error: 'Error interno' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(isAdmin(locals))) {
    return json({ ok: false, error: 'No autenticado' }, 401);
  }

  try {
    const body = (await request.json()) as { id?: string };
    if (!body.id) {
      return json({ ok: false, error: 'id requerido' }, 400);
    }

    await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(body.id).run();

    return json({ ok: true });
  } catch (err) {
    console.error('[admin/products DELETE]', err);
    return json({ ok: false, error: 'Error interno' }, 500);
  }
};
