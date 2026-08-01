import { describe, expect, it } from 'vitest';
import {
  createPaddedViewport,
  getPoiBudget,
  getViewportCacheKey,
  MAX_POI_API_RESULTS,
  MAX_RENDERED_POIS,
  MIN_POI_ZOOM,
  shouldLoadPois,
} from '../src/scripts/map-viewport-policy';

describe('shouldLoadPois', () => {
  it('exposes MIN_POI_ZOOM as the hard gate', () => {
    expect(MIN_POI_ZOOM).toBe(12);
  });

  it('returns false below the gate', () => {
    expect(shouldLoadPois(0)).toBe(false);
    expect(shouldLoadPois(11.99)).toBe(false);
  });

  it('returns true at and above the gate', () => {
    expect(shouldLoadPois(12)).toBe(true);
    expect(shouldLoadPois(15)).toBe(true);
  });
});

describe('getPoiBudget', () => {
  const LARGE_AREA = 1_000_000;

  it('buckets zoom levels at their boundaries', () => {
    expect(getPoiBudget(7.99, LARGE_AREA).zoomBucket).toBe('world');
    expect(getPoiBudget(8, LARGE_AREA).zoomBucket).toBe('region');
    expect(getPoiBudget(11.99, LARGE_AREA).zoomBucket).toBe('region');
    expect(getPoiBudget(12, LARGE_AREA).zoomBucket).toBe('city');
    expect(getPoiBudget(14.99, LARGE_AREA).zoomBucket).toBe('city');
    expect(getPoiBudget(15, LARGE_AREA).zoomBucket).toBe('street');
  });

  it('uses the maximum budget in the street bucket', () => {
    const budget = getPoiBudget(15, LARGE_AREA);
    expect(budget.apiLimit).toBe(MAX_POI_API_RESULTS);
    expect(budget.renderLimit).toBe(MAX_RENDERED_POIS);
  });

  it('reduces the budget on small screens', () => {
    const small = getPoiBudget(16, 399_999);
    const large = getPoiBudget(16, 400_000);
    expect(small.apiLimit).toBe(large.apiLimit - 3);
    expect(small.renderLimit).toBe(large.renderLimit - 6);
  });

  it('keeps the full budget at exactly 400_000 px', () => {
    const budget = getPoiBudget(16, 400_000);
    expect(budget.apiLimit).toBe(MAX_POI_API_RESULTS);
    expect(budget.renderLimit).toBe(MAX_RENDERED_POIS);
  });

  it('never drops below the minimum budget on small screens', () => {
    const smallWorld = getPoiBudget(7, 399_999);
    expect(smallWorld.apiLimit).toBe(6);
    expect(smallWorld.renderLimit).toBe(10);
  });
});

describe('getViewportCacheKey', () => {
  const baseBounds = { west: -75.61, south: 6.21, east: -75.57, north: 6.25 };

  it('is stable for a tiny pan within the same bucket', () => {
    const a = getViewportCacheKey(createPaddedViewport(baseBounds), 'city');
    const b = getViewportCacheKey(
      createPaddedViewport({
        west: -75.609,
        south: 6.211,
        east: -75.569,
        north: 6.251,
      }),
      'city'
    );
    expect(a).toBe(b);
  });

  it('changes when the pan crosses a quantization boundary', () => {
    const a = getViewportCacheKey(createPaddedViewport(baseBounds), 'city');
    const b = getViewportCacheKey(
      createPaddedViewport({
        west: -75.51,
        south: 6.31,
        east: -75.47,
        north: 6.35,
      }),
      'city'
    );
    expect(a).not.toBe(b);
  });

  it('changes when the zoom bucket changes', () => {
    const viewport = createPaddedViewport(baseBounds);
    expect(getViewportCacheKey(viewport, 'city')).not.toBe(
      getViewportCacheKey(viewport, 'street')
    );
  });
});
