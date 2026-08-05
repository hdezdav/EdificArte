import recintosData from './recintos.json';

export interface Recinto {
  id: string;
  name: string;
  type:
    | 'prehispanico'
    | 'colonial'
    | 'moderno'
    | 'barrio'
    | 'parque'
    | 'museo'
    | 'mirador';
  foundedYear: number;
  era: string;
  shortDesc: string;
  fact: string;
  wikipediaUrl: string;
  lat: number;
  lng: number;
  emoji: string;
  category: 'arqueologia' | 'museo' | 'templo' | 'rascacielos';
  // Geometry is either a real public boundary (`polygon`) or an approximate
  // circle (`radiusMeters`). Regenerate with `pnpm geo:recintos`.
  radiusMeters?: number;
  /** Closed ring of [lat, lng] pairs. Note: GeoJSON needs them flipped. */
  polygon?: [number, number][];
  /**
   * Additional disjoint rings for zones made of separate parts (e.g. Bosque de
   * Chapultepec, whose 4th section is detached from the main body). Rendered as
   * a MultiPolygon together with `polygon`.
   */
  polygons?: [number, number][][];
  /** Provenance for a real boundary. Present iff `polygon` is set. */
  geometrySource?: {
    provider: 'openstreetmap';
    /** OSM element ref, e.g. `R16823842` or `W4758957`. */
    osm: string;
    wikidata: string;
    license: 'ODbL-1.0';
    /** Set when the boundary is a documented approximation. */
    caveat?: string;
  };
  /** Why this recinto falls back to a circle. Present iff `polygon` is unset. */
  geometryFallback?: { reason: string };
  /**
   * Localized prose, consumed via `pickLocalized(recinto, field, locale)`.
   * The top-level Spanish fields stay as the `es` fallback.
   */
  translations?: {
    es?: { name?: string; era?: string; shortDesc?: string; fact?: string };
    en?: { name?: string; era?: string; shortDesc?: string; fact?: string };
  };
}

const data = recintosData as { recintos: Recinto[] };

export const RECINTOS: Recinto[] = data.recintos;

export const RECINTO_TYPES: Record<
  Recinto['type'],
  { label: string; color: string }
> = {
  prehispanico: { label: 'Prehispánico', color: '#a16207' },
  colonial: { label: 'Colonial', color: '#7c2d12' },
  moderno: { label: 'Moderno', color: '#0e7490' },
  barrio: { label: 'Barrio', color: '#9d174d' },
  parque: { label: 'Parque', color: '#15803d' },
  museo: { label: 'Museo', color: '#7c1d6f' },
  mirador: { label: 'Mirador', color: '#475569' },
};

/**
 * i18n key per zone type, resolved at render time against `mapa.zone.types.*`.
 * The `label` above stays as the Spanish fallback for non-localized surfaces.
 */
export const RECINTO_TYPE_I18N_KEY: Record<Recinto['type'], string> = {
  prehispanico: 'mapa.zone.types.prehispanico',
  colonial: 'mapa.zone.types.colonial',
  moderno: 'mapa.zone.types.moderno',
  barrio: 'mapa.zone.types.barrio',
  parque: 'mapa.zone.types.parque',
  museo: 'mapa.zone.types.museo',
  mirador: 'mapa.zone.types.mirador',
};

// Radio por defecto por tipo (metros)
export const RECINTO_DEFAULT_RADIUS: Record<Recinto['type'], number> = {
  prehispanico: 250,
  colonial: 200,
  moderno: 400,
  barrio: 800,
  parque: 1500,
  museo: 150,
  mirador: 100,
};
