import type { APIRoute } from 'astro';
import { normalizeResolvedLocation, validateCoordinates } from '../../../lib/location/country';
import { getD1ManagedItems } from '../../../lib/location/catalog';
import { getPublicExploreInfo } from '../../../lib/public-data/explore';

export const POST: APIRoute = async ({ request, locals }) => {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, location: { status: 'invalid' } }, { status: 400 }); }
  const coordinates = validateCoordinates(body);
  if (!coordinates) return Response.json({ ok: false, location: { status: 'invalid' } }, { status: 400 });

  try {
    const reverseUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coordinates.latitude}&lon=${coordinates.longitude}&zoom=10`;
    const response = await fetch(reverseUrl, { signal: AbortSignal.timeout(2500), headers: { 'user-agent': 'TuriMap Explore location resolver' } });
    if (!response.ok) return Response.json({ ok: true, location: { status: 'unresolved' }, managed: [], publicInfo: [] });
    const result = await response.json() as { address?: { country_code?: string; country?: string; city?: string; town?: string; village?: string; municipality?: string; county?: string; state?: string } };
    const city = result.address?.city || result.address?.town || result.address?.village || result.address?.municipality || result.address?.county || result.address?.state;
    const location = normalizeResolvedLocation(result.address?.country_code, city);
    if (location.status !== 'resolved') return Response.json({ ok: true, location, managed: [], publicInfo: [] });

    const managed = (await getD1ManagedItems(locals.runtime.env.DB, location.countryCode)) ?? [];
    const publicInfo = await getPublicExploreInfo({
      countryCode: location.countryCode,
      city: location.city,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    });
    const managedSource = managed.length ? 'd1' : 'none';
    return Response.json({ ok: true, location, managed, publicInfo, managedSource });
  } catch (error) {
    console.warn('[explore/location] non-fatal resolver failure', error);
    return Response.json({ ok: true, location: { status: 'unresolved' }, managed: [], publicInfo: [] });
  }
};
