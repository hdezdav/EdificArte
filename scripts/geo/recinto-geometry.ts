/**
 * Bakes real public-domain geometry into src/data/recintos.json.
 *
 * Why this exists: zone polygons used to be either hand-drawn 4-6 vertex boxes
 * at 3-decimal precision (~110 m granularity) or, for 24 of 29 recintos, fully
 * synthetic 36-point circles generated from invented per-type radii. Neither
 * described the real footprint of anything.
 *
 * Pipeline:
 *   1. Every recinto is pinned to a MANUALLY VERIFIED OpenStreetMap element
 *      (see OSM_REFS). Pinning is deliberate — fuzzy name search silently
 *      returns wrong features ("Bosque de Chapultepec" resolves to parks in
 *      Puebla and Tecamac; "Coyoacan" resolves to the whole 646-vertex
 *      alcaldia instead of the historic barrio).
 *   2. Geometry is fetched from the Nominatim /lookup endpoint, which returns
 *      ALREADY-STITCHED Polygon/MultiPolygon rings. Overpass returns unordered
 *      relation members that would have to be stitched by hand.
 *   3. Rings are simplified with Douglas-Peucker and rounded to 6 decimals
 *      (~0.11 m) so the committed payload stays small.
 *
 * Data sources (both ODbL, attribution required):
 *   - OpenStreetMap via Nominatim  https://nominatim.openstreetmap.org
 *   - Wikidata QIDs used to discover/verify the OSM refs
 *
 * Run: pnpm geo:recintos
 * Output is deterministic and committed. Re-run only to refresh boundaries.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const NOMINATIM = 'https://nominatim.openstreetmap.org/lookup';
const USER_AGENT =
  'EdificArte/0.1 (static recinto geometry baker; https://github.com/EdificArte)';

/** Max vertices kept per ring after simplification. */
const MAX_VERTICES_PER_RING = 120;
/** Coordinate output precision. 6 decimals ~= 0.11 m. */
const COORD_PRECISION = 6;

export type OsmRef = `${'N' | 'W' | 'R'}${number}`;

export interface RecintoGeometrySource {
  /** Verified OSM element that represents this recinto's real footprint. */
  osm: OsmRef;
  /** Wikidata QID the OSM element was cross-checked against. */
  wikidata: string;
  /**
   * Set when the pinned element is NOT a perfect match, so the imprecision is
   * documented in the committed data instead of being silently baked in.
   */
  caveat?: string;
}

/**
 * Manually verified OSM element per recinto.
 *
 * Verification method: each recinto's existing `wikipediaUrl` was resolved to a
 * Wikidata QID via the es.wikipedia Action API, then matched against OSM with
 * `["wikidata"="Q..."]` on Overpass. Entries that had no QID-tagged OSM element
 * were resolved with bbox-bounded Nominatim search and inspected by name +
 * feature class before being pinned here.
 */
export const OSM_REFS: Record<string, RecintoGeometrySource> = {
  'centro-historico': {
    osm: 'R16865226',
    wikidata: 'Q2146288',
    caveat:
      'INAH Perimetro A, the protected core (~3 km2). The full decreed zone is 9.7 km2 and Perimetro B (R16865356, ~10 km2) covers the outer ring.',
  },
  teotihuacan: { osm: 'W558067645', wikidata: 'Q172613' },
  cuicuilco: { osm: 'W54446511', wikidata: 'Q1143307' },
  'barrio-roma': {
    osm: 'R16823842',
    wikidata: 'Q584381',
    caveat:
      'Official Roma Norte colonia boundary. Colonia Roma also includes Roma Sur (R16823836).',
  },
  'barrio-condesa': { osm: 'R16823615', wikidata: 'Q1020125' },
  'barrio-san-angel': { osm: 'R20071361', wikidata: 'Q2067789' },
  'ciudad-universitaria': {
    osm: 'W26531801',
    wikidata: 'Q130025',
    caveat: 'UNAM main campus landuse footprint.',
  },
  'parque-mexico': { osm: 'W4758891', wikidata: 'Q3376971' },
  'alameda-central': { osm: 'W4758957', wikidata: 'Q3355305' },
  'parque-bicentenario': { osm: 'W186399291', wikidata: 'Q6062023' },
};

/**
 * Recintos removed from the zone layer because they are BUILDINGS or POINT
 * MONUMENTS, not areas. A shaded polygon over a single church or tower is
 * meaningless, and several of them sat nested inside a larger zone
 * (9 were contained by the old Tenochtitlan/Centro Historico polygon, which is
 * why that one is dropped too).
 *
 * Individual landmarks belong on the pin layer, not the zone layer:
 *   - Mapbox POI categories (POI_CATEGORIES in mapa-app.ts) cover most of them.
 *   - src/data/monuments.ts renders guaranteed local pins via getLocalPlaces()
 *     and already includes Templo Mayor, Catedral, Palacio Nacional,
 *     Torre Latinoamericana, Angel de la Independencia and Chapultepec.
 *
 * Keep this list so the removal is documented and reversible rather than a
 * silent data deletion.
 */
export const NOT_A_ZONE: Record<string, string> = {
  tlatelolco: 'Removed by maintainer request.',
  'templo-mayor': 'Archaeological building; covered by monuments.ts + Mapbox.',
  // 'tenochtitlan' is superseded by 'centro-historico' — see RENAMED_ZONES.
  'palacio-nacional': 'Single building; covered by monuments.ts.',
  'catedral-metropolitana': 'Single building; covered by monuments.ts.',
  'casa-de-los-azulejos': 'Single building.',
  'templo-san-felipe-de-jesus': 'Single church.',
  'iglesia-santo-domingo': 'Single church.',
  'palacio-inquisicion': 'Single building.',
  'reforma-222': 'Single building.',
  'auditorio-nacional': 'Single venue.',
  'estadio-azteca': 'Single venue.',
  'plaza-tres-culturas': 'Single plaza.',
  'museo-soumaya': 'Single museum building.',
  'mirador-angel-independencia':
    'Point monument; covered by monuments.ts (angel).',
  'torre-latinoamericana-mirador':
    'Single tower; covered by monuments.ts (torre-latino).',
  'mirador-castillo-chapultepec':
    'Single building; covered by monuments.ts (chapultepec).',
};

/**
 * Zones whose identity was corrected in place.
 *
 * `tenochtitlan` described the Mexica city (founded 1325, fell 1521) but was
 * drawn with the INAH Centro Historico polygon — a modern protected area. The
 * record is retitled to what the polygon actually delimits. The Mexica city
 * itself is not a mappable zone; Templo Mayor covers that story as a pin.
 *
 * Sources for the rewritten prose:
 *   - OSM R16865226 extratags: protection_title "Zona de Monumentos Historicos",
 *     protect_class 22, start_date 1980-04-11, operator
 *     "Autoridad del Centro Historico", related_law "Ley Federal sobre
 *     Monumentos y Zonas Arqueologicos, Artisticos e Historicos".
 *   - Wikidata Q2146288: UNESCO World Heritage since 1987 (ref. 412), area
 *     9.7 km2.
 *   - es.wikipedia "Centro Historico de la Ciudad de Mexico": presidential
 *     decree 11 April 1980; spans colonia Centro plus parts of 17 other
 *     colonias in Cuauhtemoc.
 */
export const RENAMED_ZONES: Record<
  string,
  {
    id: string;
    name: string;
    type: string;
    foundedYear: number;
    era: string;
    shortDesc: string;
    fact: string;
    wikipediaUrl: string;
    emoji: string;
    category: string;
  }
> = {
  tenochtitlan: {
    id: 'centro-historico',
    name: 'Centro Histórico',
    // 'barrio' (district), not 'colonial': the colonial ceiling is calibrated
    // for single buildings, and this is a ~3 km2 protected district.
    type: 'barrio',
    // The decree that created the protected zone, not the city's founding.
    foundedYear: 1980,
    era: 'Zona de Monumentos Históricos',
    shortDesc:
      'Núcleo original de la ciudad, sobre el islote de México-Tenochtitlan: 9.7 km² con la mayor concentración de monumentos históricos del país.',
    fact: 'Declarada Zona de Monumentos Históricos por decreto el 11 de abril de 1980 y Patrimonio de la Humanidad por la UNESCO en 1987.',
    wikipediaUrl:
      'https://es.wikipedia.org/wiki/Centro_Hist%C3%B3rico_de_la_Ciudad_de_M%C3%A9xico',
    emoji: '🏛️',
    category: 'arqueologia',
  },
};

/**
 * Recintos with NO usable public polygon. These keep a circle fallback, but we
 * record WHY so nobody mistakes the circle for a real boundary.
 *
 * Do not "fix" these by pinning a loosely-related element — a wrong polygon is
 * worse than an honest circle.
 */
/**
 * Zones with no single public polygon, whose boundary is DERIVED rather than
 * guessed.
 *
 * Bosque de Chapultepec has no unifying polygon anywhere: verified absent from
 * the live OSM index (api.openstreetmap.org map queries across the whole
 * footprint), from Nominatim (the 4 secciones exist only as nodes), and from
 * Wikidata Q523194 (no P3896 geoshape, no P402 relation). The old relation
 * 2514869 returns HTTP 410 Gone. OSM only has its parts: lakes, gardens, the
 * zoo and unnamed grass/forest patches.
 *


 * The ring below was hand-traced by the maintainer over the visible park extent
 * (54 vertices, single ring covering all 4 secciones) and is used VERBATIM at
 * their explicit request. Do not "improve" it by snapping to OSM vertices or by
 * deriving an outline from green features: both were tried and rejected.
 *
 * Verified: 10.89 km2 vs the real 8.66 km2 (866.37 ha) — a hand-traced concave
 * outline overestimates, which is accepted here. The ring has no
 * self-intersections; it contains all 11 checked landmarks (Castillo, Museo de
 * Antropologia, Museo Tamayo, Lago Mayor, Lago Menor, Zoologico, Los Pinos,
 * Papalote, 3a Seccion, 4a Seccion at 19.3900760,-99.2294398 and Cantera) and
 * excludes Polanco, Condesa, Lomas de Chapultepec, Bosques de las Lomas,
 * Tacubaya and Roma Norte. Flagged approximate in the UI: hand-traced, not
 * official.
 */
export const DERIVED_GEOMETRY: Record<
  string,
  {
    reason: string;
    center: [number, number];
    polygon: [number, number][];
    polygons?: [number, number][][];
  }
> = {
  'bosque-chapultepec': {
    reason:
      'Hand-traced by the maintainer over the visible park extent, covering all 4 secciones in a single ring, and used verbatim at their explicit request. No single public polygon exists (live OSM, Nominatim and Wikidata all lack one).',
    center: [19.40672, -99.210056],
    polygon: [
      [19.379638, -99.253518],
      [19.380873, -99.255175],
      [19.38721, -99.245165],
      [19.384802, -99.2412],
      [19.385837, -99.240409],
      [19.389124, -99.23932],
      [19.39144, -99.238889],
      [19.393151, -99.238091],
      [19.393027, -99.235266],
      [19.394647, -99.232979],
      [19.394622, -99.23114],
      [19.39583, -99.227618],
      [19.398191, -99.226252],
      [19.400264, -99.225387],
      [19.403567, -99.221965],
      [19.402312, -99.226121],
      [19.396947, -99.234272],
      [19.403424, -99.226738],
      [19.404563, -99.228442],
      [19.404247, -99.22604],
      [19.406653, -99.221466],
      [19.409789, -99.219368],
      [19.409734, -99.217468],
      [19.411459, -99.214162],
      [19.414363, -99.213579],
      [19.41412, -99.216214],
      [19.415622, -99.211827],
      [19.417396, -99.208419],
      [19.419405, -99.207363],
      [19.419245, -99.205294],
      [19.421658, -99.202144],
      [19.425247, -99.199572],
      [19.427318, -99.198284],
      [19.426623, -99.194697],
      [19.425997, -99.191439],
      [19.429745, -99.182655],
      [19.427445, -99.180698],
      [19.424014, -99.180077],
      [19.423174, -99.175124],
      [19.420668, -99.176667],
      [19.420451, -99.178212],
      [19.416815, -99.181215],
      [19.400313, -99.211748],
      [19.389386, -99.218372],
      [19.389214, -99.221359],
      [19.390433, -99.221719],
      [19.389423, -99.223044],
      [19.386835, -99.226725],
      [19.38431, -99.232635],
      [19.384943, -99.235902],
      [19.382483, -99.242388],
      [19.381057, -99.246725],
      [19.380647, -99.249001],
      [19.379638, -99.253518],
    ],
  },
};

export const NO_PUBLIC_GEOMETRY: Record<
  string,
  { reason: string; radiusMeters: number; center?: [number, number] }
> = {
  'bosque-chapultepec': {
    reason: 'Superseded by DERIVED_GEOMETRY; kept only as a safety net.',
    radiusMeters: 1661,
    center: [19.414333, -99.207],
  },
  'barrio-tepito': {
    reason:
      'Tepito exists in OSM only as nodes; it is a vernacular barrio with no mapped administrative boundary (surrounding colonias are Morelos and Felipe Pescador).',
    radiusMeters: 700,
  },
  'barrio-coyoacan': {
    reason:
      'The only Coyoacan polygon in OSM is the admin_level=6 alcaldia (~54 km2), roughly 25x the historic barrio. Using it would misrepresent the zone, so a circle is kept instead.',
    radiusMeters: 900,
  },
};

/**
 * Sanity ceilings per recinto type, in km². A polygon larger than this almost
 * certainly means the wrong OSM element was pinned (e.g. an alcaldia boundary
 * instead of a barrio). Baking fails loudly rather than shipping a bad zone.
 */
const MAX_AREA_KM2: Record<string, number> = {
  prehispanico: 12,
  colonial: 1,
  moderno: 10,
  barrio: 8,
  parque: 20,
  museo: 1,
  mirador: 1,
};

/** How far a polygon centroid may sit from the recinto's own coordinates, km. */
const MAX_CENTROID_DRIFT_KM = 2.5;

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG = 111.32;

/** Shoelace area on a local equirectangular projection. Ring is [lng, lat]. */
function ringAreaKm2(ring: Ring): number {
  const meanLat =
    ring.reduce((sum, [, lat]) => sum + lat, 0) / Math.max(1, ring.length);
  const scale = Math.cos((meanLat * Math.PI) / 180);
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area +=
      x1 * scale * KM_PER_DEG_LNG * (y2 * KM_PER_DEG_LAT) -
      x2 * scale * KM_PER_DEG_LNG * (y1 * KM_PER_DEG_LAT);
  }
  return Math.abs(area / 2);
}

/** Distance in km between a ring's centroid and a reference point. */
function centroidDriftKm(ring: Ring, lat: number, lng: number): number {
  const meanLat = ring.reduce((sum, [, y]) => sum + y, 0) / ring.length;
  const meanLng = ring.reduce((sum, [x]) => sum + x, 0) / ring.length;
  const scale = Math.cos((meanLat * Math.PI) / 180);
  return Math.hypot(
    (meanLat - lat) * KM_PER_DEG_LAT,
    (meanLng - lng) * KM_PER_DEG_LNG * scale
  );
}

type Ring = [number, number][];

interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

interface NominatimLookupEntry {
  osm_type: 'node' | 'way' | 'relation';
  osm_id: number;
  display_name?: string;
  geojson?: GeoJsonGeometry;
}

const round = (n: number) => Number(n.toFixed(COORD_PRECISION));

/** Perpendicular distance from p to segment a-b, in degree space. */
function perpendicularDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + clamped * dx), py - (ay + clamped * dy));
}

function douglasPeucker(points: Ring, tolerance: number): Ring {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= tolerance) return [first, last];
  return [
    ...douglasPeucker(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...douglasPeucker(points.slice(index), tolerance),
  ];
}

/**
 * Simplifies a closed ring while preserving closure, escalating tolerance until
 * the vertex budget is met. Returns null if the ring degenerates.
 */
export function simplifyRing(ring: Ring, maxVertices: number): Ring | null {
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const open = closed ? ring.slice(0, -1) : ring.slice();
  if (open.length < 3) return null;

  let result = ring;
  let tolerance = 0;
  // Budget is +1 because the closing vertex repeats the first.
  while (result.length > maxVertices + 1 && tolerance < 0.05) {
    tolerance = tolerance === 0 ? 0.00002 : tolerance * 1.6;
    const simplified = douglasPeucker([...open, open[0]], tolerance);
    if (simplified.length < 4) break;
    result = simplified;
  }

  const rounded = result.map(
    ([lng, lat]) => [round(lng), round(lat)] as [number, number]
  );
  const deduped: Ring = [];
  for (const point of rounded) {
    const previous = deduped[deduped.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      deduped.push(point);
    }
  }
  if (deduped.length < 3) return null;
  const head = deduped[0];
  const tail = deduped[deduped.length - 1];
  if (head[0] !== tail[0] || head[1] !== tail[1]) deduped.push([...head]);
  return deduped.length >= 4 ? deduped : null;
}

/** Picks the largest outer ring by absolute shoelace area. */
export function largestOuterRing(geometry: GeoJsonGeometry): Ring | null {
  const rings: Ring[] = [];
  if (geometry.type === 'Polygon') {
    const [outer] = geometry.coordinates as Ring[];
    if (outer) rings.push(outer);
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates as Ring[][]) {
      if (polygon[0]) rings.push(polygon[0]);
    }
  } else {
    return null;
  }
  let best: Ring | null = null;
  let bestArea = -1;
  for (const ring of rings) {
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    const magnitude = Math.abs(area / 2);
    if (magnitude > bestArea) {
      bestArea = magnitude;
      best = ring;
    }
  }
  return best;
}

const OSM_TYPE_PREFIX = { node: 'N', way: 'W', relation: 'R' } as const;

async function fetchGeometries(
  refs: OsmRef[]
): Promise<Map<OsmRef, NominatimLookupEntry>> {
  const found = new Map<OsmRef, NominatimLookupEntry>();
  // Nominatim /lookup accepts at most 50 ids per request.
  for (let i = 0; i < refs.length; i += 40) {
    const batch = refs.slice(i, i + 40);
    const url = `${NOMINATIM}?${new URLSearchParams({
      osm_ids: batch.join(','),
      polygon_geojson: '1',
      format: 'jsonv2',
    })}`;
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`Nominatim lookup failed: ${response.status}`);
    }
    const entries = (await response.json()) as NominatimLookupEntry[];
    for (const entry of entries) {
      found.set(
        `${OSM_TYPE_PREFIX[entry.osm_type]}${entry.osm_id}` as OsmRef,
        entry
      );
    }
    if (i + 40 < refs.length) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  return found;
}

/**
 * English prose per zone, emitted into `translations.en` so the zone card can
 * localize `era`, `shortDesc` and `fact` via pickLocalized(). The Spanish text
 * stays in the top-level fields and acts as the `es` fallback.
 */
export const ZONE_TRANSLATIONS_EN: Record<
  string,
  { era: string; shortDesc: string; fact: string }
> = {
  'centro-historico': {
    era: 'Historic Monuments Zone',
    shortDesc:
      "The city's original core, on the islet of Mexico-Tenochtitlan: 9.7 km2 holding the country's densest concentration of historic monuments.",
    fact: 'Declared a Historic Monuments Zone by decree on 11 April 1980 and a UNESCO World Heritage Site in 1987.',
  },
  teotihuacan: {
    era: 'Mesoamerican Classic period',
    shortDesc:
      'Vast archaeological complex north-east of Mexico City, home to as many as 200,000 people at its peak.',
    fact: "Its name means 'the place where men become gods', and it has been a UNESCO World Heritage Site since 1987.",
  },
  cuicuilco: {
    era: 'Mesoamerican Preclassic',
    shortDesc:
      'Archaeological site with a circular pyramid, one of the earliest ceremonial centres of the Trans-Mexican Volcanic Belt.',
    fact: 'Destroyed around 250-300 AD by the eruption of the Xitle volcano, which buried it in lava.',
  },
  'barrio-roma': {
    era: 'Porfiriato',
    shortDesc:
      'Upper-class neighbourhood from the Porfirio Diaz era, famous for its eclectic architecture and rich cultural life.',
    fact: "The 1985 earthquake left deep scars here and ultimately sparked the area's cultural revival.",
  },
  'barrio-condesa': {
    era: 'Post-revolutionary',
    shortDesc:
      'Neighbourhood south-west of Cuauhtemoc, celebrated for its cafes, bookshops, restaurants and nightlife.',
    fact: 'Charles Lindbergh landed the Spirit of St. Louis on the grounds of what is now Parque Mexico.',
  },
  'barrio-coyoacan': {
    era: 'Viceroyalty',
    shortDesc:
      'Intellectual, bohemian neighbourhood in southern Mexico City; the first seat of colonial government after the conquest.',
    fact: 'Hernan Cortes made this the first capital of New Spain, on the site of the former Tepanec lordship.',
  },
  'barrio-san-angel': {
    era: 'Viceroyalty',
    shortDesc:
      'Original township of the Alvaro Obregon borough, known for its colonial architecture and its Flower Fair.',
    fact: "Seventy-one Irish and German soldiers of the Saint Patrick's Battalion were executed here in 1847.",
  },
  'barrio-tepito': {
    era: 'Pre-Hispanic / Viceroyalty',
    shortDesc:
      "Historic neighbourhood known as the 'barrio bravo', birthplace of boxers and famous for its street market.",
    fact: 'It was one of the last sites of Mexica and Tlatelolca resistance against Cortes in 1521.',
  },
  'ciudad-universitaria': {
    era: '20th century',
    shortDesc:
      "UNAM's main campus in the Pedregal de San Angel, a collective work declared a UNESCO World Heritage Site.",
    fact: "It includes the iconic Central Library, wrapped in Juan O'Gorman's mural.",
  },
  'bosque-chapultepec': {
    era: 'Viceroyalty',
    shortDesc:
      'Urban park of 866 hectares, the largest in Latin America, divided into four sections.',
    fact: 'The 1847 Battle of Chapultepec was fought on this hill, where the Ninos Heroes died.',
  },
  'parque-mexico': {
    era: 'Post-revolutionary',
    shortDesc:
      'Nine-hectare elliptical art deco park, built over the old Jockey Club racetrack.',
    fact: 'Its Lindbergh Forum has hosted artists such as The Rolling Stones and Bob Marley.',
  },
  'alameda-central': {
    era: 'Viceroyalty',
    shortDesc:
      'The oldest public garden in Mexico and the Americas, modelled on the Alameda de Hercules in Seville.',
    fact: 'It holds the Monument to Beethoven, a replica donated by the German community.',
  },
  'parque-bicentenario': {
    era: '21st century',
    shortDesc:
      'Fifty-five-hectare park between Azcapotzalco and Miguel Hidalgo, the second-largest green lung in Mexico City.',
    fact: "Built on the remediated grounds of Pemex's decommissioned 18 de Marzo refinery.",
  },
};

interface RecintoRecord {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  radiusMeters?: number;
  polygon?: [number, number][];
  polygons?: [number, number][][];
  geometrySource?: {
    provider: 'openstreetmap';
    osm: string;
    wikidata: string;
    license: 'ODbL-1.0';
    caveat?: string;
  };
  geometryFallback?: { reason: string };
  translations?: Record<
    string,
    { era: string; shortDesc: string; fact: string }
  >;
  [key: string]: unknown;
}

export async function bakeRecintoGeometry(root = process.cwd()) {
  const path = `${root}/src/data/recintos.json`;
  const raw = JSON.parse(await readFile(path, 'utf8')) as {
    recintos: RecintoRecord[];
    [key: string]: unknown;
  };

  const refs = [...new Set(Object.values(OSM_REFS).map((r) => r.osm))];
  const geometries = await fetchGeometries(refs);

  const stats = {
    polygons: 0,
    fallbacks: 0,
    vertices: 0,
    removed: 0,
    renamed: 0,
  };
  const problems: string[] = [];

  // Correct mis-identified zones before anything else, so the rest of the bake
  // (and the NOT_A_ZONE filter) sees the final ids. Idempotent: once renamed,
  // the old id is gone and this is a no-op.
  for (const recinto of raw.recintos) {
    const renamed = RENAMED_ZONES[recinto.id];
    if (!renamed) continue;
    Object.assign(recinto, renamed);
    stats.renamed++;
  }

  // Attach English prose so the zone card can localize era/shortDesc/fact.
  // Spanish stays in the top-level fields as the `es` fallback.
  for (const recinto of raw.recintos) {
    const en = ZONE_TRANSLATIONS_EN[recinto.id];
    if (en) recinto.translations = { en };
    else delete recinto.translations;
  }

  // Drop entries that are buildings/point monuments rather than areas. The zone
  // layer is for areas only; individual landmarks belong on the pin layer.
  const before = raw.recintos.length;
  raw.recintos = raw.recintos.filter((recinto) => !NOT_A_ZONE[recinto.id]);
  stats.removed = before - raw.recintos.length;

  for (const recinto of raw.recintos) {
    const source = OSM_REFS[recinto.id];

    if (!source) {
      // A derived boundary still beats a circle, so try that first.
      const derived = DERIVED_GEOMETRY[recinto.id];
      if (derived) {
        delete recinto.radiusMeters;
        delete recinto.geometrySource;
        recinto.polygon = derived.polygon;
        if (derived.polygons) recinto.polygons = derived.polygons;
        else delete recinto.polygons;
        recinto.lat = derived.center[0];
        recinto.lng = derived.center[1];
        // Still flagged as a fallback: the shape is derived, not official, so
        // the UI keeps showing its "approximate area" notice.
        recinto.geometryFallback = { reason: derived.reason };
        stats.fallbacks++;
        stats.vertices +=
          derived.polygon.length +
          (derived.polygons ?? []).reduce((sum, r) => sum + r.length, 0);
        continue;
      }

      const fallback = NO_PUBLIC_GEOMETRY[recinto.id];
      if (!fallback) {
        problems.push(`${recinto.id}: no OSM ref and no documented fallback`);
        continue;
      }
      delete recinto.polygon;
      delete recinto.geometrySource;
      // Explicit radius: the circle is approximate, so say so in the data
      // rather than leaning on an implicit per-type default.
      recinto.radiusMeters = fallback.radiusMeters;
      if (fallback.center) {
        recinto.lat = fallback.center[0];
        recinto.lng = fallback.center[1];
      }
      recinto.geometryFallback = { reason: fallback.reason };
      stats.fallbacks++;
      continue;
    }

    const entry = geometries.get(source.osm);
    if (!entry?.geojson) {
      problems.push(`${recinto.id}: ${source.osm} returned no geometry`);
      continue;
    }

    const outer = largestOuterRing(entry.geojson);
    if (!outer) {
      problems.push(
        `${recinto.id}: ${source.osm} is ${entry.geojson.type}, not a polygon`
      );
      continue;
    }

    const simplified = simplifyRing(outer, MAX_VERTICES_PER_RING);
    if (!simplified) {
      problems.push(`${recinto.id}: ${source.osm} ring degenerated`);
      continue;
    }

    // Guard against pinning the wrong OSM element. Both checks have already
    // caught real mistakes: a same-named church 12 km away, and an alcaldia
    // boundary standing in for a barrio.
    const drift = centroidDriftKm(simplified, recinto.lat, recinto.lng);
    if (drift > MAX_CENTROID_DRIFT_KM) {
      problems.push(
        `${recinto.id}: ${source.osm} centroid is ${drift.toFixed(2)} km from the recinto coordinates — likely the wrong element`
      );
      continue;
    }
    const area = ringAreaKm2(simplified);
    const ceiling = MAX_AREA_KM2[recinto.type] ?? 20;
    if (area > ceiling) {
      problems.push(
        `${recinto.id}: ${source.osm} covers ${area.toFixed(2)} km², above the ${ceiling} km² ceiling for type "${recinto.type}" — likely too coarse`
      );
      continue;
    }

    // recintos.json stores [lat, lng]; GeoJSON gives [lng, lat].
    recinto.polygon = simplified.map(([lng, lat]) => [lat, lng]);
    recinto.geometrySource = {
      provider: 'openstreetmap',
      osm: source.osm,
      wikidata: source.wikidata,
      license: 'ODbL-1.0',
      ...(source.caveat ? { caveat: source.caveat } : {}),
    };
    delete recinto.radiusMeters;
    delete recinto.geometryFallback;
    // Single-ring OSM boundary: clear any multi-part leftovers.
    delete recinto.polygons;
    stats.polygons++;
    stats.vertices += simplified.length;
  }

  if (problems.length > 0) {
    throw new Error(`Geometry baking failed:\n  ${problems.join('\n  ')}`);
  }

  raw.generatedAt = new Date().toISOString().slice(0, 10);
  raw.geometryAttribution =
    'Zone boundaries © OpenStreetMap contributors, ODbL 1.0 (via Nominatim). Cross-referenced with Wikidata.';

  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`);
  return stats;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const stats = await bakeRecintoGeometry();
  console.log(
    `recintos.json: ${stats.polygons} real polygons (${stats.vertices} vertices), ${stats.fallbacks} approximate circles, ${stats.removed} non-zone entries removed`
  );
}
