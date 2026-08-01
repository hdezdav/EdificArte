// ---------------------------------------------------------------------------
// Supercluster-backed pin clustering for /map.
//
// Framework-free on purpose: this module knows nothing about Mapbox GL or the
// DOM. It takes plain places ({id, lng, lat}) plus plain {west,south,east,
// north} bounds and a zoom level, so it is fully unit-testable in node.
// mapa-app.ts owns turning the returned entries into DOM markers.
// ---------------------------------------------------------------------------
import Supercluster from 'supercluster';

export interface ClusterablePlace {
  id: string;
  lng: number;
  lat: number;
}

export interface ClusterViewportBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface PinClusterPoint {
  kind: 'point';
  placeId: string;
  lng: number;
  lat: number;
}

export interface PinClusterGroup {
  kind: 'cluster';
  clusterId: number;
  lng: number;
  lat: number;
  pointCount: number;
}

export type PinClusterEntry = PinClusterPoint | PinClusterGroup;

// Cluster radius in pixels (relative to supercluster's default 512 extent).
export const CLUSTER_RADIUS_PX = 60;
// First zoom level with NO clustering: at and above this zoom every pin
// renders as an individual marker. supercluster still clusters AT its own
// maxZoom level and only expands at maxZoom + 1, so the option passed to
// supercluster is one level lower than this public constant.
export const CLUSTER_MAX_ZOOM = 15;

type PinPointProperties = { placeId: string };

export type PinClusterIndex = Supercluster<PinPointProperties>;

export function buildClusterIndex(
  places: readonly ClusterablePlace[]
): PinClusterIndex {
  const index: PinClusterIndex = new Supercluster<PinPointProperties>({
    radius: CLUSTER_RADIUS_PX,
    maxZoom: CLUSTER_MAX_ZOOM - 1,
  });
  index.load(
    places.map((place) => ({
      type: 'Feature' as const,
      properties: { placeId: place.id },
      geometry: {
        type: 'Point' as const,
        coordinates: [place.lng, place.lat],
      },
    }))
  );
  return index;
}

export function getClusterFeatures(
  index: PinClusterIndex,
  bounds: ClusterViewportBounds,
  zoom: number
): PinClusterEntry[] {
  const features = index.getClusters(
    [bounds.west, bounds.south, bounds.east, bounds.north],
    Math.floor(zoom)
  );
  const entries: PinClusterEntry[] = [];
  for (const feature of features) {
    const [lng, lat] = feature.geometry.coordinates;
    const props = feature.properties;
    if ('cluster' in props && props.cluster) {
      entries.push({
        kind: 'cluster',
        clusterId: props.cluster_id,
        lng,
        lat,
        pointCount: props.point_count,
      });
    } else {
      entries.push({
        kind: 'point',
        placeId: (props as PinPointProperties).placeId,
        lng,
        lat,
      });
    }
  }
  return entries;
}

export function getExpansionZoom(
  index: PinClusterIndex,
  clusterId: number
): number {
  return index.getClusterExpansionZoom(clusterId);
}
