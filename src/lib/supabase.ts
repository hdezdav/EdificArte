/**
 * Cloudflare D1 + KV Data Types & Stub compatibility layer.
 *
 * Supabase has been migrated to Cloudflare D1 (SQLite Edge) & Cloudflare KV (Sessions).
 */

export interface PlaceRow {
  id: string;
  slug: string;
  name: string;
  category: 'museum' | 'temple' | 'park' | 'historic' | 'viewpoint' | 'remote';
  country_code: string; // ISO 3166-1 alpha-2
  city: string;
  lat: number;
  lng: number;
  cover_image_url: string | null;
  audio_url: string | null;
  video_url: string | null;
  is_vr_available: boolean;
  price_cents: number | null;
  currency: string | null;
  emoji: string | null;
  translations: Record<string, Record<string, string>>;
  is_published: boolean;
}

export interface TourRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  city: string;
  country_code: string;
  price_cents: number;
  currency: string;
  duration_min: number | null;
  meeting_point: string | null;
  cover_image_url: string | null;
  guide_name: string | null;
  guide_title: string | null;
  guide_bio: string | null;
  stops: string[];
  highlights: string[];
  translations: Record<string, Record<string, string>>;
  is_published: boolean;
}

export function getSupabase(): null {
  return null;
}

export async function findPlacesNearby(
  _lat: number,
  _lng: number,
  _radiusMeters = 5000
): Promise<PlaceRow[]> {
  return [];
}