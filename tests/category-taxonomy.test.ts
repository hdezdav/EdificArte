import { describe, expect, it } from 'vitest';
import {
  CATEGORY_TAXONOMY,
  canonicalIdForChip,
  getCanonicalCategoryInfo,
  normalizeCategory,
  type CanonicalCategoryId,
} from '../src/lib/category-taxonomy';

// getCategoryInfo-equivalent (mapa-app.ts composes these two the same way).
const infoForRaw = (raw: string) =>
  getCanonicalCategoryInfo(normalizeCategory(raw));

describe('CATEGORY_TAXONOMY table integrity', () => {
  it('resolves every synonym entry to its own canonical id', () => {
    for (const [id, info] of Object.entries(CATEGORY_TAXONOMY)) {
      for (const synonym of info.synonyms) {
        expect(normalizeCategory(synonym)).toBe(id);
      }
    }
  });

  it('keeps synonyms disjoint across categories', () => {
    const seen = new Map<string, string>();
    for (const [id, info] of Object.entries(CATEGORY_TAXONOMY)) {
      for (const synonym of info.synonyms) {
        expect(seen.has(synonym)).toBe(false);
        seen.set(synonym, id);
      }
    }
  });

  it('is idempotent: canonical ids normalize to themselves', () => {
    const ids: CanonicalCategoryId[] = [
      'museum',
      'temple',
      'park',
      'historic',
      'viewpoint',
      'attraction',
      'default',
    ];
    for (const id of ids) {
      expect(normalizeCategory(id)).toBe(id);
    }
  });
});

describe('normalizeCategory — vocabulary coverage', () => {
  it.each([
    // Mapbox API English
    ['museum', 'museum'],
    ['art_gallery', 'museum'],
    ['place_of_worship', 'temple'],
    ['park', 'park'],
    ['historic', 'historic'],
    ['castle', 'historic'],
    ['archaeological_site', 'historic'],
    ['viewpoint', 'viewpoint'],
    ['attraction', 'attraction'],
    ['theatre', 'attraction'],
    // monuments.ts Spanish types
    ['museo', 'museum'],
    ['templo', 'temple'],
    ['arqueologia', 'historic'],
    ['rascacielos', 'attraction'],
    ['sitio-remoto', 'historic'],
    // recintos.ts Spanish types
    ['prehispanico', 'historic'],
    ['colonial', 'historic'],
    ['moderno', 'attraction'],
    ['barrio', 'attraction'],
    ['parque', 'park'],
    ['mirador', 'viewpoint'],
  ] as const)('maps %s → %s', (raw, expected) => {
    expect(normalizeCategory(raw)).toBe(expected);
  });
});

describe('normalizeCategory — accents and case', () => {
  it.each([
    ['Museo', 'museum'],
    ['MUSEO', 'museum'],
    ['Arqueología', 'historic'],
    ['Templo', 'temple'],
    ['Catedral', 'temple'],
    ['Prehispánico', 'historic'],
    ['Pirámide', 'historic'],
    ['Jardín', 'park'],
    ['MIRADOR', 'viewpoint'],
    ['Galería', 'museum'],
  ] as const)('maps %s → %s', (raw, expected) => {
    expect(normalizeCategory(raw)).toBe(expected);
  });
});

describe('normalizeCategory — array input', () => {
  it('picks the first raw producing a non-default match', () => {
    expect(normalizeCategory(['default-thing', 'museo'])).toBe('museum');
    expect(normalizeCategory(['art_gallery', 'museum'])).toBe('museum');
  });

  it('checks ALL raws for exact matches before fragment fallbacks', () => {
    // 'unknown museum compound' would fragment-match museum, but the exact
    // synonym 'templo' in a later raw must win first.
    expect(normalizeCategory(['unknown museum compound', 'templo'])).toBe(
      'temple'
    );
  });

  it('handles empty and all-unknown arrays', () => {
    expect(normalizeCategory([])).toBe('default');
    expect(normalizeCategory(['unknown', 'also-unknown'])).toBe('default');
  });
});

describe('normalizeCategory — defensive raw / unknown handling', () => {
  it('returns default for null, undefined, empty and unknown values', () => {
    expect(normalizeCategory(null)).toBe('default');
    expect(normalizeCategory(undefined)).toBe('default');
    expect(normalizeCategory('')).toBe('default');
    expect(normalizeCategory('   ')).toBe('default');
    expect(normalizeCategory('total-unknown')).toBe('default');
  });

  it('fragment-matches compound human-readable labels', () => {
    expect(normalizeCategory('Museum / Theater')).toBe('museum');
    expect(normalizeCategory('Church / Temple')).toBe('temple');
    expect(normalizeCategory('Historic Monument')).toBe('historic');
    expect(normalizeCategory('Viewpoint / Skyscraper')).toBe('viewpoint');
    expect(normalizeCategory('Archaeological Site · Teotihuacan')).toBe(
      'historic'
    );
  });

  it('getCategoryInfo-equivalent handles raw strings defensively', () => {
    expect(infoForRaw('Museo')).toEqual({ emoji: '🏛️', label: 'Museum' });
    expect(infoForRaw('Arqueología')).toEqual({
      emoji: '🏰',
      label: 'Historic Site',
    });
    expect(infoForRaw('something-random')).toEqual({
      emoji: '📍',
      label: 'Place',
    });
  });
});

describe('getCanonicalCategoryInfo', () => {
  it('returns emoji and label for each canonical id', () => {
    expect(getCanonicalCategoryInfo('museum')).toEqual({
      emoji: '🏛️',
      label: 'Museum',
    });
    expect(getCanonicalCategoryInfo('temple')).toEqual({
      emoji: '⛪',
      label: 'Temple',
    });
    expect(getCanonicalCategoryInfo('park')).toEqual({
      emoji: '🌳',
      label: 'Park',
    });
    expect(getCanonicalCategoryInfo('historic')).toEqual({
      emoji: '🏰',
      label: 'Historic Site',
    });
    expect(getCanonicalCategoryInfo('viewpoint')).toEqual({
      emoji: '🔭',
      label: 'Viewpoint',
    });
    expect(getCanonicalCategoryInfo('attraction')).toEqual({
      emoji: '⭐',
      label: 'Attraction',
    });
    expect(getCanonicalCategoryInfo('default')).toEqual({
      emoji: '📍',
      label: 'Place',
    });
  });
});

describe('canonicalIdForChip', () => {
  it("maps 'all' to null (no filtering)", () => {
    expect(canonicalIdForChip('all')).toBeNull();
  });

  it.each([
    ['museum', 'museum'],
    ['temple', 'temple'],
    ['park', 'park'],
    ['historic', 'historic'],
    ['viewpoint', 'viewpoint'],
  ] as const)('maps chip %s → %s', (chip, expected) => {
    expect(canonicalIdForChip(chip)).toBe(expected);
  });

  it('attraction and default have NO chip (visible only under all)', () => {
    expect(canonicalIdForChip('attraction')).toBeNull();
    expect(canonicalIdForChip('default')).toBeNull();
  });

  it('returns null for unknown chip values', () => {
    expect(canonicalIdForChip('nonsense')).toBeNull();
    expect(canonicalIdForChip('')).toBeNull();
  });
});
