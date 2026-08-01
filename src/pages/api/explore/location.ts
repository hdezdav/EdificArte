import type { APIRoute } from 'astro';
import { normalizeResolvedLocation, validateCoordinates, type LocationState } from '../../../lib/location/country';
import { getD1ManagedItems } from '../../../lib/location/catalog';
import { getPublicExploreInfo } from '../../../lib/public-data/explore';

function resolveFallbackLocation(lat: number, lng: number): LocationState {
  // Mexico bounding box estimation for fallback
  if (lat >= 14.0 && lat <= 33.0 && lng >= -118.0 && lng <= -86.0) {
    return { status: 'resolved', countryCode: 'MX', city: 'Ciudad de México' };
  }
  return { status: 'unresolved' };
}

export const POST: APIRoute = async ({ request, locals }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, location: { status: 'invalid' } }, { status: 400 });
  }

  const coordinates = validateCoordinates(body);
  if (!coordinates) {
    return Response.json({ ok: false, location: { status: 'invalid' } }, { status: 400 });
  }

  let location: LocationState = { status: 'unresolved' };

  try {
    const reverseUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coordinates.latitude}&lon=${coordinates.longitude}&zoom=10`;
    const response = await fetch(reverseUrl, {
      signal: AbortSignal.timeout(3000),
      headers: {
        'user-agent': 'EdificARTE/1.0 (https://edificarte.app)',
        'accept-language': 'es,en;q=0.9',
      },
    });

    if (response.ok) {
      const result = (await response.json()) as {
        address?: {
          country_code?: string;
          country?: string;
          city?: string;
          town?: string;
          village?: string;
          municipality?: string;
          county?: string;
          state?: string;
        };
      };
      const city =
        result.address?.city ||
        result.address?.town ||
        result.address?.village ||
        result.address?.municipality ||
        result.address?.county ||
        result.address?.state;
      location = normalizeResolvedLocation(result.address?.country_code, city);
    }
  } catch (error) {
    console.warn('[explore/location] Reverse geocode fetch failed, using fallback:', error);
  }

  if (location.status !== 'resolved') {
    location = resolveFallbackLocation(coordinates.latitude, coordinates.longitude);
  }

  const countryCode = location.status === 'resolved' ? location.countryCode : 'MX';

  let managed: unknown[] = [];
  try {
    managed = (await getD1ManagedItems(locals.runtime.env.DB, countryCode)) ?? [];
  } catch (err) {
    console.warn('[explore/location] D1 items query fallback:', err);
  }

  let publicInfo: unknown[] = [];
  try {
    publicInfo = await getPublicExploreInfo({
      countryCode,
      city: location.status === 'resolved' ? location.city : 'Ciudad de México',
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    });
  } catch (err) {
    console.warn('[explore/location] Public info query fallback:', err);
  }

  const managedSource = managed.length ? 'd1' : 'none';
  return Response.json({ ok: true, location, managed, publicInfo, managedSource });
};
