export type LocationState =
  | { status: 'unknown' | 'denied' | 'unavailable' | 'invalid' | 'unresolved' }
  | { status: 'resolved'; countryCode: string; city?: string };

export type Coordinates = { latitude: number; longitude: number };

export function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function validateCoordinates(value: unknown): Coordinates | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as { latitude?: unknown; longitude?: unknown };
  const latitude = typeof input.latitude === 'number' ? input.latitude : NaN;
  const longitude = typeof input.longitude === 'number' ? input.longitude : NaN;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

export function normalizeResolvedLocation(country: unknown, city?: unknown): LocationState {
  const countryCode = normalizeCountryCode(country);
  if (!countryCode) return { status: 'unresolved' };
  return {
    status: 'resolved',
    countryCode,
    ...(typeof city === 'string' && city.trim() ? { city: city.trim().slice(0, 120) } : {}),
  };
}
