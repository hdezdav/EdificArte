import { describe, expect, it } from 'vitest';
import {
  buildClusterIndex,
  getClusterFeatures,
  getExpansionZoom,
  CLUSTER_MAX_ZOOM,
  type ClusterablePlace,
} from '../src/scripts/map-pin-clustering';

// University campus: 5 places within ~50 m of each other (≈±0.0002°).
const CAMPUS_PLACES: ClusterablePlace[] = [
  { id: 'uni-main', lng: -75.57, lat: 6.242 },
  { id: 'uni-library', lng: -75.5701, lat: 6.2421 },
  { id: 'uni-museum', lng: -75.5699, lat: 6.2421 },
  { id: 'uni-hall', lng: -75.57, lat: 6.2422 },
  { id: 'uni-lab', lng: -75.5702, lat: 6.242 },
];

const CAMPUS_BOUNDS = { west: -75.58, south: 6.23, east: -75.56, north: 6.25 };

function clustersIn(entries: ReturnType<typeof getClusterFeatures>) {
  return entries.filter((entry) => entry.kind === 'cluster');
}

function pointsIn(entries: ReturnType<typeof getClusterFeatures>) {
  return entries.filter((entry) => entry.kind === 'point');
}

describe('buildClusterIndex + getClusterFeatures', () => {
  it('keeps far-apart places as separate individuals at low zoom', () => {
    // Medellín and CDMX: ~24° apart, thousands of pixels at zoom 5.
    const index = buildClusterIndex([
      { id: 'medellin', lng: -75.57, lat: 6.242 },
      { id: 'cdmx', lng: -99.1332, lat: 19.4326 },
    ]);
    const entries = getClusterFeatures(
      index,
      { west: -100, south: 5, east: -74, north: 20 },
      5
    );
    expect(entries).toHaveLength(2);
    expect(clustersIn(entries)).toHaveLength(0);
    expect(pointsIn(entries).map((p) => p.placeId).sort()).toEqual([
      'cdmx',
      'medellin',
    ]);
  });

  it('collapses close places into one cluster with the full count at low zoom', () => {
    const index = buildClusterIndex(CAMPUS_PLACES);
    const entries = getClusterFeatures(index, CAMPUS_BOUNDS, 10);
    expect(entries).toHaveLength(1);
    const cluster = entries[0];
    expect(cluster.kind).toBe('cluster');
    if (cluster.kind === 'cluster') {
      expect(cluster.pointCount).toBe(CAMPUS_PLACES.length);
    }
  });

  it('expands to individual leaves above the cluster max zoom', () => {
    const index = buildClusterIndex(CAMPUS_PLACES);
    const entries = getClusterFeatures(
      index,
      CAMPUS_BOUNDS,
      CLUSTER_MAX_ZOOM + 1
    );
    expect(clustersIn(entries)).toHaveLength(0);
    expect(pointsIn(entries)).toHaveLength(CAMPUS_PLACES.length);
  });

  it('behaves as individuals exactly at the cluster max zoom boundary', () => {
    const index = buildClusterIndex(CAMPUS_PLACES);
    const entries = getClusterFeatures(index, CAMPUS_BOUNDS, CLUSTER_MAX_ZOOM);
    expect(clustersIn(entries)).toHaveLength(0);
    expect(pointsIn(entries).map((p) => p.placeId).sort()).toEqual(
      CAMPUS_PLACES.map((p) => p.id).sort()
    );
  });

  it('changes cluster contents when the index is rebuilt with a subset (category filter)', () => {
    const full = buildClusterIndex(CAMPUS_PLACES);
    const fullEntries = getClusterFeatures(full, CAMPUS_BOUNDS, 10);
    expect(fullEntries).toHaveLength(1);
    if (fullEntries[0].kind === 'cluster') {
      expect(fullEntries[0].pointCount).toBe(5);
    }

    // Simulates a category filter keeping only 3 of the 5 campus places.
    const filtered = buildClusterIndex(CAMPUS_PLACES.slice(0, 3));
    const filteredEntries = getClusterFeatures(filtered, CAMPUS_BOUNDS, 10);
    expect(filteredEntries).toHaveLength(1);
    if (filteredEntries[0].kind === 'cluster') {
      expect(filteredEntries[0].pointCount).toBe(3);
    }
  });
});

describe('getExpansionZoom', () => {
  it('returns a zoom greater than the current one for a cluster', () => {
    const index = buildClusterIndex(CAMPUS_PLACES);
    const currentZoom = 10;
    const entries = getClusterFeatures(index, CAMPUS_BOUNDS, currentZoom);
    const cluster = entries[0];
    expect(cluster.kind).toBe('cluster');
    if (cluster.kind === 'cluster') {
      const expansionZoom = getExpansionZoom(index, cluster.clusterId);
      expect(expansionZoom).toBeGreaterThan(currentZoom);
      expect(expansionZoom).toBeLessThanOrEqual(CLUSTER_MAX_ZOOM);
    }
  });
});
