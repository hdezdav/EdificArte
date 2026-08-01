import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/admin';

interface TourRow {
  id: string;
  title: string;
  subtitle: string;
  duration: string;
  price_per_person: number;
  currency: string;
  image: string;
  highlights: string; // JSON array
  description: string;
  meeting_point: string;
  city: string;
  country: string;
  country_code?: string;
  guide: string; // JSON object { name, title, bio }
  category: string;
  translations: string; // JSON object
  is_published: number;
  created_at: string;
}

interface TourBody {
  id?: string;
  title?: string;
  subtitle?: string;
  duration?: string;
  pricePerPerson?: number;
  price_per_person?: number;
  currency?: string;
  image?: string;
  highlights?: string[];
  description?: string;
  meetingPoint?: string;
  meeting_point?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  guide?: { name: string; title: string; bio: string };
  category?: string;
  translations?: Record<string, unknown>;
  is_published?: boolean;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeCountry(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[a-zA-Z]{2}$/.test(value.trim())) return null;
  return value.trim().toUpperCase();
}

function parseTour(r: TourRow) {
  return {
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    duration: r.duration,
    pricePerPerson: r.price_per_person,
    currency: r.currency,
    image: r.image,
    highlights: parseJson<string[]>(r.highlights, []),
    description: r.description,
    meetingPoint: r.meeting_point,
    city: r.city,
    country: r.country,
    countryCode: normalizeCountry(r.country_code) || normalizeCountry(r.country),
    guide: parseJson<{ name: string; title: string; bio: string }>(r.guide, { name: '', title: '', bio: '' }),
    category: r.category,
    translations: parseJson<Record<string, unknown>>(r.translations, {}),
    is_published: !!r.is_published,
    created_at: r.created_at,
  };
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

    let query = 'SELECT * FROM tours';
    let countQuery = 'SELECT COUNT(*) as count FROM tours';
    const binds: unknown[] = [];

    if (search) {
      const where = ' WHERE title LIKE ? OR city LIKE ? OR country LIKE ?';
      query += where;
      countQuery += where;
      binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

    const countResult = await env.DB.prepare(countQuery).bind(...binds).first<{ count: number }>();
    const { results } = await env.DB.prepare(query).bind(...binds, limit, offset).all();

    return json({
      ok: true,
      tours: ((results ?? []) as unknown as TourRow[]).map(parseTour),
      total: countResult?.count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    console.error('[admin/tours GET]', err);
    return json({ ok: false, error: 'Error interno' }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(isAdmin(locals))) {
    return json({ ok: false, error: 'No autenticado' }, 401);
  }

  try {
    const body = (await request.json()) as TourBody;
    if (!body.title) {
      return json({ ok: false, error: 'title requerido' }, 400);
    }

    const id = body.id || crypto.randomUUID();
    const price = body.pricePerPerson ?? body.price_per_person ?? 0;
    const meetingPoint = body.meetingPoint ?? body.meeting_point ?? '';
    const countryCode = normalizeCountry(body.countryCode ?? body.country);
    if (body.countryCode !== undefined && !countryCode) return json({ ok: false, error: 'countryCode must be ISO alpha-2' }, 400);

    await env.DB.prepare(
       'INSERT INTO tours (id, title, subtitle, duration, price_per_person, currency, image, highlights, description, meeting_point, city, country, country_code, guide, category, translations, is_published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id,
      body.title,
      body.subtitle ?? '',
      body.duration ?? '',
      price,
      body.currency ?? 'MXN',
      body.image ?? '',
      JSON.stringify(body.highlights ?? []),
      body.description ?? '',
      meetingPoint,
      body.city ?? '',
      body.country ?? '',
      countryCode,
      JSON.stringify(body.guide ?? { name: '', title: '', bio: '' }),
      body.category ?? 'tour',
      JSON.stringify(body.translations ?? {}),
      body.is_published === false ? 0 : 1
    ).run();

    return json({ ok: true, id });
  } catch (err) {
    console.error('[admin/tours POST]', err);
    return json({ ok: false, error: 'Error interno' }, 500);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(isAdmin(locals))) {
    return json({ ok: false, error: 'No autenticado' }, 401);
  }

  try {
    const body = (await request.json()) as TourBody;
    if (!body.id) {
      return json({ ok: false, error: 'id requerido' }, 400);
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (body.title !== undefined) { fields.push('title = ?'); values.push(body.title); }
    if (body.subtitle !== undefined) { fields.push('subtitle = ?'); values.push(body.subtitle); }
    if (body.duration !== undefined) { fields.push('duration = ?'); values.push(body.duration); }
    if (body.pricePerPerson !== undefined) { fields.push('price_per_person = ?'); values.push(body.pricePerPerson); }
    if (body.image !== undefined) { fields.push('image = ?'); values.push(body.image); }
    if (body.highlights !== undefined) { fields.push('highlights = ?'); values.push(JSON.stringify(body.highlights)); }
    if (body.description !== undefined) { fields.push('description = ?'); values.push(body.description); }
    if (body.meetingPoint !== undefined) { fields.push('meeting_point = ?'); values.push(body.meetingPoint); }
    if (body.city !== undefined) { fields.push('city = ?'); values.push(body.city); }
    if (body.country !== undefined) { fields.push('country = ?'); values.push(body.country); }
    if (body.countryCode !== undefined) {
      const countryCode = normalizeCountry(body.countryCode);
      if (!countryCode) return json({ ok: false, error: 'countryCode must be ISO alpha-2' }, 400);
      fields.push('country_code = ?'); values.push(countryCode);
    } else if (body.country !== undefined) {
      const countryCode = normalizeCountry(body.country);
      if (countryCode) { fields.push('country_code = ?'); values.push(countryCode); }
    }
    if (body.guide !== undefined) { fields.push('guide = ?'); values.push(JSON.stringify(body.guide)); }
    if (body.category !== undefined) { fields.push('category = ?'); values.push(body.category); }
    if (body.translations !== undefined) { fields.push('translations = ?'); values.push(JSON.stringify(body.translations)); }
    if (body.is_published !== undefined) { fields.push('is_published = ?'); values.push(body.is_published ? 1 : 0); }

    if (fields.length === 0) {
      return json({ ok: false, error: 'Nada que actualizar' }, 400);
    }

    values.push(body.id);
    await env.DB.prepare(`UPDATE tours SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

    return json({ ok: true });
  } catch (err) {
    console.error('[admin/tours PATCH]', err);
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

    await env.DB.prepare('DELETE FROM tours WHERE id = ?').bind(body.id).run();

    return json({ ok: true });
  } catch (err) {
    console.error('[admin/tours DELETE]', err);
    return json({ ok: false, error: 'Error interno' }, 500);
  }
};
