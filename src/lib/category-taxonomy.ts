/**
 * Canonical category taxonomy — single source of truth for pin categories.
 *
 * Pin categories previously mixed three vocabularies:
 *   - Mapbox API English (`museum`, `place_of_worship`, `viewpoint`, ...)
 *   - src/data/monuments.ts Spanish types (`museo`, `templo`, `arqueologia`, ...)
 *   - src/data/recintos.ts Spanish types (`prehispanico`, `colonial`, `mirador`, ...)
 *
 * Every ingestion point in mapa-app.ts normalizes raw category strings through
 * normalizeCategory(), so Place.category is ALWAYS a CanonicalCategoryId.
 * Matching is two-pass: exact synonym match first (across ALL raw values when
 * given an array), then `fragments` substring match as a defensive fallback
 * for compound raw strings (e.g. "Museum / Theater").
 */

export type CanonicalCategoryId =
  | 'museum'
  | 'temple'
  | 'park'
  | 'historic'
  | 'viewpoint'
  | 'attraction'
  | 'default';

export interface CanonicalCategory {
  emoji: string;
  label: string;
  synonyms: string[];
  fragments?: string[];
}

export const CATEGORY_TAXONOMY: Record<CanonicalCategoryId, CanonicalCategory> =
  {
    museum: {
      emoji: '🏛️',
      label: 'Museum',
      synonyms: ['museum', 'museo', 'art_gallery', 'gallery', 'galeria'],
      fragments: ['museum', 'museo', 'gallery', 'galeria'],
    },
    temple: {
      emoji: '⛪',
      label: 'Temple',
      synonyms: [
        'temple',
        'place_of_worship',
        'church',
        'cathedral',
        'catedral',
        'chapel',
        'capilla',
        'templo',
        'iglesia',
        'basilica',
        'santuario',
      ],
      fragments: [
        'temple',
        'worship',
        'church',
        'cathedral',
        'catedral',
        'chapel',
        'capilla',
        'templo',
        'iglesia',
        'basilica',
        'santuario',
      ],
    },
    park: {
      emoji: '🌳',
      label: 'Park',
      synonyms: ['park', 'parque', 'garden', 'jardin', 'nature_reserve'],
      fragments: ['park', 'parque', 'garden', 'jardin'],
    },
    historic: {
      emoji: '🏰',
      label: 'Historic Site',
      synonyms: [
        'historic',
        'castle',
        'monument',
        'monumento',
        'archaeological_site',
        'arqueologia',
        'prehispanico',
        'colonial',
        'ruins',
        'ruina',
        'pyramid',
        'piramide',
        'fort',
        'fuerte',
        'sitio-remoto',
        'sitio_historico',
      ],
      fragments: [
        'historic',
        'castle',
        'monument',
        'monumento',
        'archaeolog',
        'arqueolog',
        'prehispan',
        'colonial',
        'ruin',
        'pyramid',
        'piramid',
        'fort',
        'fuerte',
        'sitio',
      ],
    },
    viewpoint: {
      emoji: '🔭',
      label: 'Viewpoint',
      synonyms: ['viewpoint', 'mirador', 'overlook', 'scenic'],
      fragments: ['viewpoint', 'mirador', 'overlook', 'scenic'],
    },
    attraction: {
      emoji: '⭐',
      label: 'Attraction',
      synonyms: [
        'attraction',
        'tourist_attraction',
        'theatre',
        'teatro',
        'theme_park',
        'rascacielos',
        'moderno',
        'barrio',
      ],
      fragments: [
        'attraction',
        'theatr',
        'teatro',
        'rascacielos',
        'moderno',
        'barrio',
        'skyscraper',
      ],
    },
    default: {
      emoji: '📍',
      label: 'Place',
      synonyms: [],
    },
  };

// Fragment scan order (most culturally specific categories first is NOT the
// goal — taxonomy declaration order is deterministic and matches the previous
// CATEGORY_ICONS iteration order, preserving legacy display behavior).
const FRAGMENT_SCAN_ORDER: CanonicalCategoryId[] = [
  'museum',
  'temple',
  'park',
  'historic',
  'viewpoint',
  'attraction',
];

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    // strip combining diacritical marks (NFD-decomposed accents)
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const EXACT_LOOKUP = new Map<string, CanonicalCategoryId>();
for (const [id, info] of Object.entries(CATEGORY_TAXONOMY) as [
  CanonicalCategoryId,
  CanonicalCategory,
][]) {
  for (const synonym of info.synonyms) {
    EXACT_LOOKUP.set(normalizeText(synonym), id);
  }
}

function exactMatch(value: string): CanonicalCategoryId | null {
  return EXACT_LOOKUP.get(value) ?? null;
}

function fragmentMatch(value: string): CanonicalCategoryId | null {
  for (const id of FRAGMENT_SCAN_ORDER) {
    const fragments = CATEGORY_TAXONOMY[id].fragments;
    if (!fragments) continue;
    for (const fragment of fragments) {
      if (value.includes(fragment)) return id;
    }
  }
  return null;
}

/**
 * Normalize a raw category value (Mapbox poi_category array, Spanish monument
 * type, human-readable label, ...) to a CanonicalCategoryId.
 *
 * Array input: the first raw value producing a non-default match wins, but ALL
 * raw values are checked for exact synonym matches before ANY fragment
 * substring matching is attempted.
 */
export function normalizeCategory(
  raw: string | string[] | null | undefined
): CanonicalCategoryId {
  const values = (Array.isArray(raw) ? raw : [raw])
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(normalizeText);
  if (values.length === 0) return 'default';

  for (const value of values) {
    const hit = exactMatch(value);
    if (hit) return hit;
  }
  for (const value of values) {
    const hit = fragmentMatch(value);
    if (hit) return hit;
  }
  return 'default';
}

export function getCanonicalCategoryInfo(id: CanonicalCategoryId): {
  emoji: string;
  label: string;
} {
  const info = CATEGORY_TAXONOMY[id] ?? CATEGORY_TAXONOMY.default;
  return { emoji: info.emoji, label: info.label };
}

/**
 * Map a filter-chip data-filter value to its canonical id.
 * 'all' (and anything else, including attraction/default which have NO chip)
 * returns null, meaning "no category filtering".
 */
export function canonicalIdForChip(
  chipFilter: string
): CanonicalCategoryId | null {
  switch (chipFilter) {
    case 'museum':
    case 'temple':
    case 'park':
    case 'historic':
    case 'viewpoint':
      return chipFilter;
    default:
      return null;
  }
}
