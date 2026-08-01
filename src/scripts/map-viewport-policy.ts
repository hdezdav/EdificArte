export interface RawViewportBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface PaddedViewport {
  west: number;
  south: number;
  east: number;
  north: number;
  centerLng: number;
  bbox: string | null;
}

export interface PoiBudget {
  apiLimit: number;
  renderLimit: number;
  zoomBucket: string;
}

export const VIEWPORT_PADDING_RATIO = 0.15;
export const MAX_POI_API_RESULTS = 25;
export const MAX_RENDERED_POIS = 48;
// Hard zoom gate: below this zoom no POIs are loaded or rendered at all.
export const MIN_POI_ZOOM = 12;

const MAX_MERCATOR_LATITUDE = 85.051129;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeLongitude(longitude: number): number {
  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 && longitude > 0 ? 180 : normalized;
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(5)).toString();
}

export function createPaddedViewport(
  bounds: RawViewportBounds,
  paddingRatio = VIEWPORT_PADDING_RATIO
): PaddedViewport {
  let east = bounds.east;
  while (east <= bounds.west) east += 360;

  const longitudeSpan = Math.min(360, east - bounds.west);
  const latitudeSpan = Math.max(0, bounds.north - bounds.south);
  const longitudePadding = longitudeSpan * paddingRatio;
  const latitudePadding = latitudeSpan * paddingRatio;
  const unwrappedWest = bounds.west - longitudePadding;
  const unwrappedEast = east + longitudePadding;
  const centerLng = normalizeLongitude((bounds.west + east) / 2);
  const south = clamp(
    bounds.south - latitudePadding,
    -MAX_MERCATOR_LATITUDE,
    MAX_MERCATOR_LATITUDE
  );
  const north = clamp(
    bounds.north + latitudePadding,
    -MAX_MERCATOR_LATITUDE,
    MAX_MERCATOR_LATITUDE
  );

  const midpoint = (unwrappedWest + unwrappedEast) / 2;
  const shift = Math.round((centerLng - midpoint) / 360) * 360;
  const shiftedWest = unwrappedWest + shift;
  const shiftedEast = unwrappedEast + shift;
  const bbox =
    shiftedEast - shiftedWest < 360 &&
    shiftedWest >= -180 &&
    shiftedEast <= 180 &&
    south < north
      ? [shiftedWest, south, shiftedEast, north].map(formatCoordinate).join(',')
      : null;

  return {
    west: shiftedWest,
    south,
    east: shiftedEast,
    north,
    centerLng,
    bbox,
  };
}

export function viewportContains(
  viewport: PaddedViewport,
  lng: number,
  lat: number
): boolean {
  if (lat < viewport.south || lat > viewport.north) return false;
  let unwrappedLng = lng;
  while (unwrappedLng - viewport.centerLng > 180) unwrappedLng -= 360;
  while (unwrappedLng - viewport.centerLng < -180) unwrappedLng += 360;
  return unwrappedLng >= viewport.west && unwrappedLng <= viewport.east;
}

export function shouldLoadPois(zoom: number): boolean {
  return zoom >= MIN_POI_ZOOM;
}

export function getPoiBudget(
  zoom: number,
  viewportPixelArea: number
): PoiBudget {
  let budget: PoiBudget;
  if (zoom < 8) {
    budget = { apiLimit: 8, renderLimit: 12, zoomBucket: 'world' };
  } else if (zoom < 12) {
    budget = { apiLimit: 12, renderLimit: 20, zoomBucket: 'region' };
  } else if (zoom < 15) {
    budget = { apiLimit: 18, renderLimit: 32, zoomBucket: 'city' };
  } else {
    budget = {
      apiLimit: MAX_POI_API_RESULTS,
      renderLimit: MAX_RENDERED_POIS,
      zoomBucket: 'street',
    };
  }

  if (viewportPixelArea < 400_000) {
    budget.apiLimit = Math.max(6, budget.apiLimit - 3);
    budget.renderLimit = Math.max(10, budget.renderLimit - 6);
  }
  return budget;
}

export function getViewportCacheKey(
  viewport: PaddedViewport,
  zoomBucket: string
): string {
  const precision =
    zoomBucket === 'world'
      ? 1
      : zoomBucket === 'region'
        ? 0.25
        : zoomBucket === 'city'
          ? 0.05
          : 0.01;
  const quantize = (value: number) => Math.round(value / precision) * precision;
  return [
    zoomBucket,
    quantize(viewport.west),
    quantize(viewport.south),
    quantize(viewport.east),
    quantize(viewport.north),
  ].join(':');
}
