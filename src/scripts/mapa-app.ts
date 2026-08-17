import 'mapbox-gl/dist/mapbox-gl.css';
import mapboxgl from 'mapbox-gl';
import type { Map, Marker } from 'mapbox-gl';
import { MONUMENTS } from '../data/monuments';
import {
  RECINTOS,
  RECINTO_TYPES,
  RECINTO_TYPE_I18N_KEY,
  RECINTO_DEFAULT_RADIUS,
} from '../data/recintos';
import { detectLocale, pickLocalized, translate } from '../lib/i18n';
import {
  createPaddedViewport,
  getPoiBudget,
  getViewportCacheKey,
  MAX_RENDERED_POIS,
  shouldLoadPois,
  viewportContains,
  type PaddedViewport,
  type PoiBudget,
} from './map-viewport-policy';
import {
  TravelVisualization,
  getTravelMode,
  type TravelMode,
} from './map-travel-visualization';
import {
  canonicalIdForChip,
  getCanonicalCategoryInfo,
  normalizeCategory,
} from '../lib/category-taxonomy';
import {
  buildClusterIndex,
  getClusterFeatures,
  getExpansionZoom,
  type PinClusterEntry,
  type PinClusterGroup,
  type PinClusterIndex,
} from './map-pin-clustering';

// ---------------------------------------------------------------------------
// Token - injected at build time via Astro's inline script
// ---------------------------------------------------------------------------
const MAPBOX_TOKEN = (window as unknown as { __TURIMAP_TOKEN__?: string })
  .__TURIMAP_TOKEN__;
if (!MAPBOX_TOKEN) {
  console.error(
    '[EdificARTE] No Mapbox token found. Set MAPBOX_TOKEN in .dev.vars'
  );
}

mapboxgl.accessToken = MAPBOX_TOKEN || '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Place {
  id: string;
  name: string;
  category: string;
  address: string;
  lat: number;
  lng: number;
  distance?: number;
  isLocalMonument?: boolean;
  emoji?: string;
  videoUrl?: string;
  isVRAvailable?: boolean;
}

interface MapboxSearchResultFeature {
  id?: string;
  geometry: {
    coordinates: [number, number];
  };
  properties?: {
    poi_category?: string[];
    category?: string;
    name?: string;
    full_address?: string;
    address?: string;
  };
}

interface MapboxGeocodingFeature {
  id?: string;
  center: [number, number];
  text?: string;
  place_name?: string;
  properties?: {
    category?: string;
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const deviceMemory =
  (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
const isAndroid = /Android/i.test(navigator.userAgent);
const isLowPowerDevice =
  isAndroid || deviceMemory <= 4 || navigator.hardwareConcurrency <= 4;

let map: Map;
let userMarker: Marker | null = null;
let selectedPlace: Place | null = null;
let isCollapsed = true;
let watchId: number | null = null;
let userLat: number | null = null;
let userLng: number | null = null;
// Start every device on Mapbox Standard, but defer its expensive 3D objects.
// This keeps the first paint fast on Android without permanently downgrading
// the map to the simpler Streets geometry.
let currentStyleIdx = 0;
let nearbyPlaces: Place[] = [];
// Cache key of the last viewport actually rendered (fetch + merge + DOM).
// 'below-zoom' sentinel: the zoom gate rendered the hint, not places.
let lastRenderedCacheKey: string | null = null;
interface PlaceMarkerRecord {
  marker: Marker;
  place: Place;
}
const placeMarkers = new globalThis.Map<string, PlaceMarkerRecord>();
const clusterMarkers: Marker[] = [];
// Supercluster index over getFilteredPlaces(nearbyPlaces), excluding route
// pins and the selected place (both always render as individual pins).
let clusterIndex: PinClusterIndex | null = null;
// Bumped on every index rebuild so the render signature can never go stale.
let clusterDataVersion = 0;
let clusterRenderSignature = '';

// Pin filter chips state (mapa.astro #map-filter-chips)
// Chip data-filter values map 1:1 to canonical category ids; the mapping
// lives in src/lib/category-taxonomy.ts (canonicalIdForChip).
let activePinFilter = 'all';
let filterChipsListenerBound = false;
let travelVisualization: TravelVisualization | null = null;
let detailed3DEnabled = false;
let detailed3DDelay: ReturnType<typeof setTimeout> | null = null;
let detailed3DIdleHandle: number | null = null;

const STYLES = [
  { id: 'mapbox://styles/mapbox/standard', label: 'Standard' },
  { id: 'mapbox://styles/mapbox/streets-v12', label: 'Streets' },
  { id: 'mapbox://styles/mapbox/dark-v11', label: 'Dark' },
  { id: 'mapbox://styles/mapbox/satellite-streets-v12', label: 'Satellite' },
];

// Categories of POIs to query from Mapbox
const POI_CATEGORIES = [
  'museum',
  'art_gallery',
  'monument',
  'historic',
  'place_of_worship',
  'castle',
  'park',
  'theatre',
  'viewpoint',
  'attraction',
  'archaeological_site',
];

const NEARBY_CACHE_TTL_MS = 10 * 60 * 1000;
const NEARBY_CACHE_MAX_ENTRIES = 24;
const MOVEEND_REFRESH_DEBOUNCE_MS = 650;
const nearbyPlacesCache = new globalThis.Map<
  string,
  { createdAt: number; places: Place[] }
>();

function pruneNearbyCache(now = Date.now()): void {
  for (const [key, entry] of nearbyPlacesCache) {
    if (now - entry.createdAt > NEARBY_CACHE_TTL_MS) {
      nearbyPlacesCache.delete(key);
    }
  }
  while (nearbyPlacesCache.size > NEARBY_CACHE_MAX_ENTRIES) {
    const oldestKey = nearbyPlacesCache.keys().next().value;
    if (oldestKey === undefined) break;
    nearbyPlacesCache.delete(oldestKey);
  }
}

function readNearbyCache(key: string): Place[] | null {
  pruneNearbyCache();
  const cached = nearbyPlacesCache.get(key);
  if (!cached) return null;
  nearbyPlacesCache.delete(key);
  nearbyPlacesCache.set(key, cached);
  return cached.places;
}

function writeNearbyCache(key: string, places: Place[]): Place[] {
  nearbyPlacesCache.delete(key);
  nearbyPlacesCache.set(key, {
    createdAt: Date.now(),
    places,
  });
  pruneNearbyCache();
  return places;
}

// Category icons/labels live in src/lib/category-taxonomy.ts (single source
// of truth) — see getCategoryInfo below.

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

// ---------------------------------------------------------------------------
export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

// Global sheet element variables (to prevent stale element references during page transition morphs)
let bottomSheet: HTMLElement | null = null;
let sheetHeader: HTMLElement | null = null;
let sheetChevron: HTMLElement | null = null;
let sheetBody: HTMLElement | null = null;
let floatingControls: HTMLElement | null = null;

function updateSheetUI() {
  if (!bottomSheet || !sheetChevron || !sheetBody) return;

  const isMobile = window.innerWidth < 768;

  if (isCollapsed) {
    sheetBody.style.maxHeight = '0px';
    sheetBody.style.opacity = '0';
    sheetBody.style.pointerEvents = 'none';
    sheetChevron.style.transform = 'rotate(0deg)';
    if (floatingControls) {
      floatingControls.style.bottom =
        'calc(8.25rem + env(safe-area-inset-bottom, 0px))';
    }
  } else {
    const h = isMobile ? '280px' : '450px';
    sheetBody.style.maxHeight = h;
    sheetBody.style.opacity = '1';
    sheetBody.style.pointerEvents = 'auto';
    sheetChevron.style.transform = 'rotate(180deg)';
    if (floatingControls) {
      const bottomOffset = isMobile
        ? 'calc(26rem + env(safe-area-inset-bottom, 0px))'
        : 'calc(36.5rem + env(safe-area-inset-bottom, 0px))';
      floatingControls.style.bottom = bottomOffset;
    }
  }
}

// ---------------------------------------------------------------------------
// Nearby Places - fetch from Mapbox Tilequery / Geocoding
// ---------------------------------------------------------------------------
async function fetchNearbyPlaces(
  lng: number,
  lat: number,
  viewport: PaddedViewport,
  budget: PoiBudget,
  cacheKey: string,
  signal?: AbortSignal
): Promise<Place[]> {
  const cached = readNearbyCache(cacheKey);
  if (cached) {
    // Normalize category on read so stale caches (raw Mapbox/Spanish
    // vocabularies from before the taxonomy refactor) self-heal.
    return cached
      .map((place) => ({
        ...place,
        category: normalizeCategory(place.category),
        distance: haversine(lat, lng, place.lat, place.lng),
      }))
      .sort((a, b) => (a.distance || 0) - (b.distance || 0));
  }

  const categories = POI_CATEGORIES.join(',');
  const params = new URLSearchParams({
    proximity: `${lng},${lat}`,
    limit: String(budget.apiLimit),
    language: 'en',
    access_token: MAPBOX_TOKEN || '',
  });
  if (viewport.bbox) params.set('bbox', viewport.bbox);
  const url = `https://api.mapbox.com/search/searchbox/v1/category/${categories}?${params}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      // Fallback: use Geocoding API for POIs
      const fallback = await fetchNearbyViaGeocoding(
        lng,
        lat,
        viewport,
        signal
      );
      return writeNearbyCache(cacheKey, fallback);
    }
    const data = await res.json();
    if (!data.features?.length) {
      const fallback = await fetchNearbyViaGeocoding(
        lng,
        lat,
        viewport,
        signal
      );
      return writeNearbyCache(cacheKey, fallback);
    }

    const places = data.features
      .map((f: MapboxSearchResultFeature) => {
        const coords = f.geometry.coordinates;
        const props = f.properties || {};
        // Pass the FULL poi_category array: first non-default match wins.
        const cat = normalizeCategory(
          props.poi_category?.length ? props.poi_category : props.category
        );
        const distKm = haversine(lat, lng, coords[1], coords[0]);
        return {
          id: f.id || `place-${coords[0].toFixed(5)}-${coords[1].toFixed(5)}`,
          name: props.name || props.full_address || 'Unknown Place',
          category: cat,
          address: props.full_address || props.address || '',
          lat: coords[1],
          lng: coords[0],
          distance: distKm,
        };
      })
      .filter((place: Place) =>
        viewportContains(viewport, place.lng, place.lat)
      )
      .sort((a: Place, b: Place) => (a.distance || 0) - (b.distance || 0));
    return writeNearbyCache(cacheKey, places);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    console.warn('[TuriMap] Category search failed, trying geocoding:', err);
    const fallback = await fetchNearbyViaGeocoding(lng, lat, viewport, signal);
    return writeNearbyCache(cacheKey, fallback);
  }
}

async function fetchNearbyViaGeocoding(
  lng: number,
  lat: number,
  viewport: PaddedViewport,
  signal?: AbortSignal
): Promise<Place[]> {
  const types = 'poi';
  const params = new URLSearchParams({
    proximity: `${lng},${lat}`,
    types,
    limit: '10',
    language: 'en',
    access_token: MAPBOX_TOKEN || '',
  });
  if (viewport.bbox) params.set('bbox', viewport.bbox);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/tourism.json?${params}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || [])
      .map((f: MapboxGeocodingFeature, i: number) => {
        const [fLng, fLat] = f.center;
        const distKm = haversine(lat, lng, fLat, fLng);
        return {
          id: f.id || `geo-${i}`,
          name: f.text || f.place_name || 'Unknown',
          category: normalizeCategory(f.properties?.category),
          address: f.place_name || '',
          lat: fLat,
          lng: fLng,
          distance: distKm,
        };
      })
      .filter((place: Place) =>
        viewportContains(viewport, place.lng, place.lat)
      )
      .sort((a: Place, b: Place) => (a.distance || 0) - (b.distance || 0));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return [];
  }
}

function getLocalPlaces(
  centerLng: number,
  centerLat: number,
  viewport: PaddedViewport
): Place[] {
  const locale = detectLocale();
  return MONUMENTS.filter((monument) =>
    viewportContains(viewport, monument.lng, monument.lat)
  )
    .map((m) => {
      const distKm = haversine(centerLat, centerLng, m.lat, m.lng);
      return {
        id: m.id,
        name: pickLocalized(m, 'name', locale),
        category: normalizeCategory(m.type || 'monument'),
        address: pickLocalized(m, 'desc', locale),
        lat: m.lat,
        lng: m.lng,
        distance: distKm,
      };
    })
    .sort((a, b) => (a.distance || 0) - (b.distance || 0));
}

function getMergedNearbyPlaces(
  mapboxPlaces: Place[],
  centerLng: number,
  centerLat: number,
  viewport: PaddedViewport,
  renderLimit: number
): Place[] {
  const localPlaces = getLocalPlaces(centerLng, centerLat, viewport);
  if (!localPlaces.length) return mapboxPlaces.slice(0, renderLimit);

  const combined = [...localPlaces, ...mapboxPlaces];
  const seen = new Set<string>();
  const unique: Place[] = [];
  for (const p of combined) {
    const key = p.id + '_' + p.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  return unique
    .sort((a, b) => (a.distance || 0) - (b.distance || 0))
    .slice(0, renderLimit);
}

function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function getCategoryInfo(cat: string): { emoji: string; label: string } {
  // Defensive: accept any raw vocabulary (Mapbox English, Spanish monument
  // types, human-readable labels) — normalize inside.
  return getCanonicalCategoryInfo(normalizeCategory(cat));
}

function isPlaceVisibleForFilter(place: Place): boolean {
  if (activePinFilter === 'all') return true;
  if (place.category === 'route') return true;
  const canonicalId = canonicalIdForChip(activePinFilter);
  if (!canonicalId) return true;
  // Categories are canonicalized at ingestion — exact match, no substring.
  return place.category === canonicalId;
}

function getFilteredPlaces(places: Place[]): Place[] {
  if (activePinFilter === 'all') return places;
  return places.filter(isPlaceVisibleForFilter);
}

// ---------------------------------------------------------------------------
// Place Markers (supercluster-backed)
// ---------------------------------------------------------------------------
function removeAllPinMarkers(): void {
  placeMarkers.forEach(({ marker }) => marker.remove());
  placeMarkers.clear();
  for (const marker of clusterMarkers) marker.remove();
  clusterMarkers.length = 0;
}

function clearPlaceMarkers() {
  removeAllPinMarkers();
  clusterRenderSignature = '';
}

function updateMarkerElement(element: HTMLElement, place: Place): void {
  const info = getCategoryInfo(place.category);
  element.innerHTML = `<span>${info.emoji}</span>`;
  element.title = place.name;
  element.setAttribute('aria-label', place.name);
  element.classList.toggle('selected', selectedPlace?.id === place.id);
}

function createPlacePinMarker(place: Place): void {
  const el = document.createElement('div');
  el.className = 'turimap-pin';
  el.role = 'button';
  el.tabIndex = 0;
  updateMarkerElement(el, place);

  const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
    .setLngLat([place.lng, place.lat])
    .addTo(map);

  const activate = (e: Event) => {
    e.stopPropagation();
    const currentPlace = placeMarkers.get(place.id)?.place;
    if (currentPlace) selectPlace(currentPlace);
  };
  el.addEventListener('click', activate);
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(event);
    }
  });
  placeMarkers.set(place.id, { marker, place });
}

function createClusterPinMarker(entry: PinClusterGroup): void {
  const el = document.createElement('div');
  el.className = 'turimap-pin turimap-pin-cluster';
  el.role = 'button';
  el.tabIndex = 0;
  el.innerHTML = `<span class="turimap-pin-cluster-count">${entry.pointCount}</span>`;
  const hint = trMapa(
    'mapa.cluster.expand_hint',
    'Lugares agrupados — toca para acercar'
  );
  el.title = `${entry.pointCount} · ${hint}`;
  el.setAttribute('aria-label', `${entry.pointCount} · ${hint}`);

  const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
    .setLngLat([entry.lng, entry.lat])
    .addTo(map);

  const activate = (e: Event) => {
    e.stopPropagation();
    if (!clusterIndex || isMapRemoved()) return;
    map.easeTo({
      center: [entry.lng, entry.lat],
      zoom: getExpansionZoom(clusterIndex, entry.clusterId),
    });
  };
  el.addEventListener('click', activate);
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(event);
    }
  });
  clusterMarkers.push(marker);
}

function getClusterRenderSignature(
  entries: PinClusterEntry[],
  zoom: number
): string {
  const parts = entries.map((entry) =>
    entry.kind === 'cluster'
      ? `c${entry.clusterId}:${entry.pointCount}@${entry.lng.toFixed(5)},${entry.lat.toFixed(5)}`
      : `p${entry.placeId}@${entry.lng.toFixed(5)},${entry.lat.toFixed(5)}`
  );
  return [
    zoom,
    clusterDataVersion,
    selectedPlace?.id ?? '',
    activePinFilter,
    ...parts,
  ].join('|');
}

// Render pins for the current viewport: cluster groups become count pins,
// leaves keep the regular glass pin. Full clear + rebuild per render — cheap
// at the ≤48 place cap; the signature short-circuit avoids redundant DOM work.
function renderClusteredPins(): void {
  if (!map || !clusterIndex || isMapRemoved()) return;
  // Below MIN_POI_ZOOM the zoom gate owns pin state: no pins, no clusters.
  if (!shouldLoadPois(map.getZoom())) return;
  const bounds = map.getBounds();
  if (!bounds) return;

  const zoom = Math.floor(map.getZoom());
  const entries = getClusterFeatures(
    clusterIndex,
    {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    },
    zoom
  );

  const signature = getClusterRenderSignature(entries, zoom);
  if (signature === clusterRenderSignature) return;

  removeAllPinMarkers();
  clusterRenderSignature = signature;

  const filtered = getFilteredPlaces(nearbyPlaces);
  const placesById = new globalThis.Map(filtered.map((p) => [p.id, p]));
  for (const entry of entries) {
    if (entry.kind === 'cluster') {
      createClusterPinMarker(entry);
      continue;
    }
    const place = placesById.get(entry.placeId);
    if (place) createPlacePinMarker(place);
  }
  // Route pins never join the cluster index — render them individually.
  for (const place of filtered) {
    if (place.category === 'route' && place.id !== selectedPlace?.id) {
      createPlacePinMarker(place);
    }
  }
  // The selected place is excluded from the index and always renders on top.
  const selected = selectedPlace;
  if (selected && nearbyPlaces.some((p) => p.id === selected.id)) {
    createPlacePinMarker(selected);
  }
}

// Rebuild the cluster index (data, filter or selection changed) and render.
function refreshClusteredPins(): void {
  // Nearby places or the active filter may have changed, so the open zone
  // card's place list would otherwise go stale.
  if (activeZone) renderZonePlaces(activeZone);
  clusterIndex = buildClusterIndex(
    getFilteredPlaces(nearbyPlaces).filter(
      (place) => place.category !== 'route' && place.id !== selectedPlace?.id
    )
  );
  clusterDataVersion++;
  renderClusteredPins();
}

// Minimal i18n reader for module-scope strings: Layout injects the dicts as
// window.__TURIMAP_I18N__; falls back to the es dict, then to `fallback`.
function trMapa(key: string, fallback: string): string {
  const dicts = (
    window as unknown as {
      __TURIMAP_I18N__?: {
        es?: Record<string, unknown>;
        en?: Record<string, unknown>;
      };
    }
  ).__TURIMAP_I18N__;
  const localeDict = dicts?.[detectLocale()];
  const resolved = localeDict ? translate(localeDict, key) : key;
  if (resolved !== key) return resolved;
  const esResolved = dicts?.es ? translate(dicts.es, key) : key;
  return esResolved !== key ? esResolved : fallback;
}

function renderZoomGateHint() {
  const container = $('places-list-container');
  if (!container) return;
  container.innerHTML = '';
  const hint = document.createElement('p');
  hint.className =
    'py-6 text-center text-[12px] text-slate-450 dark:text-slate-500';
  hint.textContent = trMapa(
    'mapa.sheet.zoom_hint',
    'Acércate para descubrir lugares cercanos'
  );
  container.appendChild(hint);
}

function renderList(places: Place[]) {
  const container = $('places-list-container');
  if (!container) return;
  container.innerHTML = '';

  if (!places.length) {
    const empty = document.createElement('p');
    empty.className =
      'py-6 text-center text-[12px] text-slate-450 dark:text-slate-500';
    empty.textContent = 'No places found nearby. Try moving the map.';
    container.appendChild(empty);
    return;
  }

  places.forEach((place) => {
    const info = getCategoryInfo(place.category);
    const el = document.createElement('div');
    el.className =
      'flex items-center gap-2.5 rounded-2xl border border-slate-200/50 dark:border-slate-800/50 bg-white/60 dark:bg-slate-900/60 py-2 px-3 backdrop-blur-md transition-all hover:bg-white/80 dark:hover:bg-slate-900/80 cursor-pointer active:scale-[0.98] shadow-sm';

    el.innerHTML = `
      <span class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-lg">${info.emoji}</span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-[12px] font-bold text-slate-800 dark:text-white">${place.name}</p>
        <p class="text-[10px] font-medium text-slate-500 dark:text-slate-400">${info.label} · <span class="font-semibold text-slate-700 dark:text-slate-300">${place.distance ? formatDistance(place.distance) : ''}</span></p>
      </div>
      <span class="material-symbols-outlined text-slate-400 dark:text-slate-500 text-[16px]">chevron_right</span>
    `;

    el.addEventListener('click', () => selectPlace(place));
    container.appendChild(el);
  });
}

// ---------------------------------------------------------------------------
// Pin filter chips
// ---------------------------------------------------------------------------
function setActivePinFilter(filter: string): void {
  activePinFilter = filter;
  // The cluster index is built over the filtered places, so a filter change
  // must rebuild it (and the pins) instead of toggling marker visibility.
  refreshClusteredPins();
  // While the zoom gate is active the list shows the hint, not places —
  // filter changes must not swap it for the generic empty message.
  if (lastRenderedCacheKey === 'below-zoom') {
    renderZoomGateHint();
    return;
  }
  renderList(getFilteredPlaces(nearbyPlaces));
}

function bindFilterChips(): void {
  if (filterChipsListenerBound) return;
  filterChipsListenerBound = true;
  // Delegated listener: survives Astro body swaps; the guard above prevents
  // duplicate bindings since this module is a singleton.
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const chip = target?.closest?.('#map-filter-chips .filter-chip');
    if (!(chip instanceof HTMLButtonElement)) return;
    const filter = chip.dataset.filter;
    if (!filter || filter === activePinFilter) return;
    $('map-filter-chips')
      ?.querySelectorAll('.filter-chip')
      .forEach((el) => el.classList.toggle('active', el === chip));
    setActivePinFilter(filter);
  });
}

// ---------------------------------------------------------------------------
// Wikipedia enrichment
// ---------------------------------------------------------------------------
const wikiCache = new globalThis.Map<
  string,
  { imageUrl: string; articleUrl: string } | null
>();

async function fetchWikipediaEnrichment(
  name: string
): Promise<{ imageUrl: string; articleUrl: string } | null> {
  const key = name.toLowerCase().trim();
  if (wikiCache.has(key)) return wikiCache.get(key)!;

  const cleanQuery = name
    .split(',')[0]
    .replace(/[\u1F300-\u1FAFF\u2600-\u26FF]/g, '')
    .trim();
  const searchUrl = `https://es.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(cleanQuery)}&gsrlimit=1&prop=pageimages|info&piprop=thumbnail&pithumbsize=600&inprop=url&format=json&origin=*`;

  try {
    const res = await fetch(searchUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: 'application/json' },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        query?: {
          pages?: Record<
            string,
            { thumbnail?: { source?: string }; fullurl?: string }
          >;
        };
      };
      const page = Object.values(data.query?.pages ?? {})[0];
      if (page) {
        const result = {
          imageUrl: page.thumbnail?.source ?? '',
          articleUrl:
            page.fullurl ??
            `https://es.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(cleanQuery)}`,
        };
        wikiCache.set(key, result);
        return result;
      }
    }
  } catch (err) {
    console.warn(
      '[Wikipedia] Search generator query failed, trying direct title:',
      err
    );
  }

  const titleUrl = `https://es.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(cleanQuery)}&prop=pageimages|info&piprop=thumbnail&pithumbsize=600&inprop=url&redirects=1&format=json&origin=*`;
  try {
    const res = await fetch(titleUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      wikiCache.set(key, null);
      return null;
    }
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            missing?: string;
            thumbnail?: { source?: string };
            fullurl?: string;
          }
        >;
      };
    };
    const page = Object.values(data.query?.pages ?? {})[0];
    if (!page || 'missing' in page) {
      wikiCache.set(key, null);
      return null;
    }
    const result = {
      imageUrl: page.thumbnail?.source ?? '',
      articleUrl:
        page.fullurl ??
        `https://es.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(cleanQuery)}`,
    };
    wikiCache.set(key, result);
    return result;
  } catch {
    wikiCache.set(key, null);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
function selectPlace(place: Place) {
  selectedPlace = place;
  const info = getCategoryInfo(place.category);

  map.flyTo({
    center: [place.lng, place.lat],
    zoom: 17,
    pitch: 55,
    duration: 1200,
  });

  // Update detail view
  const detailEmoji = $('detail-emoji');
  const detailName = $('detail-name');
  const detailCategory = $('detail-category');
  const detailAddress = $('detail-address');

  if (detailEmoji)
    detailEmoji.textContent = place.category === 'route' ? '🧭' : info.emoji;
  if (detailName) detailName.textContent = place.name;
  if (detailCategory) {
    detailCategory.innerHTML =
      place.category === 'route'
        ? 'Ruta de Monumentos'
        : `${info.label} · <span class="font-semibold text-slate-700 dark:text-slate-300">${place.distance ? formatDistance(place.distance) : ''}</span>`;
  }
  if (detailAddress) detailAddress.textContent = place.address;

  const monumentMatch = MONUMENTS.find(
    (m) =>
      m.id === place.id || m.name.toLowerCase() === place.name.toLowerCase()
  );

  // Wikipedia enrichment — fetch async, show photo + link if a match is found
  const wikiBlock = document.getElementById('detail-wiki');
  const img = document.getElementById(
    'detail-wiki-img'
  ) as HTMLImageElement | null;
  const link = document.getElementById(
    'detail-wiki-link'
  ) as HTMLAnchorElement | null;

  if (monumentMatch?.image && img) {
    img.src = monumentMatch.image;
    if (link) {
      link.href = `https://es.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(place.name)}`;
    }
    if (wikiBlock) wikiBlock.classList.remove('hidden');
  } else if (wikiBlock) {
    wikiBlock.classList.add('hidden');
  }

  void fetchWikipediaEnrichment(place.name).then((wiki) => {
    if (!wiki || selectedPlace?.id !== place.id) return; // user moved on
    if (img && wiki.imageUrl) img.src = wiki.imageUrl;
    if (link && wiki.articleUrl) link.href = wiki.articleUrl;
    if (wikiBlock) wikiBlock.classList.remove('hidden');
  });

  // VR Video Experience — Embed VR video player when monument or place has videoUrl
  const vrContainer = document.getElementById('detail-vr-container');
  const vrIframe = document.getElementById(
    'detail-vr-iframe'
  ) as HTMLIFrameElement | null;
  const videoUrl = place.videoUrl || monumentMatch?.videoUrl;

  if (vrContainer && vrIframe) {
    if (videoUrl) {
      vrIframe.src = videoUrl;
      vrContainer.classList.remove('hidden');
    } else {
      vrIframe.src = '';
      vrContainer.classList.add('hidden');
    }
  }

  // Audio Guide Player
  const audioContainer = document.getElementById('detail-audio-container');
  const detailDuration = document.getElementById('detail-duration');
  stopAudio();
  if (audioContainer) {
    if (monumentMatch?.audioDuration || (monumentMatch as any)?.audioUrl) {
      if (detailDuration)
        detailDuration.textContent = monumentMatch.audioDuration || '1:50';
      audioContainer.classList.remove('hidden');
    } else {
      audioContainer.classList.add('hidden');
    }
  }

  // Selection excludes the place from the cluster index — re-render so the
  // selected pin always shows individually with its .selected state.
  refreshClusteredPins();

  // Navigation - draw route on map
  const navBtn = $('btn-navigate');
  if (navBtn) {
    if (place.id === 'ai-route') {
      navBtn.classList.add('hidden');
    } else {
      navBtn.classList.remove('hidden');
      navBtn.onclick = () => {
        if (userLng !== null && userLat !== null) {
          routeRequestController?.abort();
          const controller = new AbortController();
          routeRequestController = controller;
          void drawRoute(userLng, userLat, place.lng, place.lat, controller);
        } else {
          alert('Enable GPS to get directions.');
        }
      };
    }
  }

  $('view-list')?.classList.add('hidden');
  $('view-detail')?.classList.remove('hidden');
  isCollapsed = false;
  updateSheetUI();
}

// ---------------------------------------------------------------------------
// In-Map Routing (Mapbox Directions API)
// ---------------------------------------------------------------------------
interface DirectionsRoute {
  duration: number;
  distance: number;
  geometry: GeoJSON.LineString;
}

function updateRouteInfo(mode: TravelMode, text: string) {
  const routeInfo = $('route-info');
  const routeText = $('route-info-text');
  const routeIcon = $('route-mode-icon');
  if (!routeInfo || !routeText) return;
  routeText.textContent = text;
  if (routeIcon) {
    routeIcon.textContent =
      mode === 'walking'
        ? 'directions_walk'
        : mode === 'driving'
          ? 'directions_car'
          : 'flight';
  }
  routeInfo.classList.remove('hidden');
}

function isMapRemoved() {
  return !map || (map as Map & { _removed?: boolean })._removed === true;
}

function fitTravelBounds(coordinates: [number, number][], maxZoom: number) {
  const bounds = new mapboxgl.LngLatBounds();
  coordinates.forEach((coordinate) => bounds.extend(coordinate));
  map.fitBounds(bounds, {
    padding: { top: 120, bottom: 200, left: 60, right: 60 },
    maxZoom,
  });
}

async function fetchDirectionsRoute(
  profile: 'walking' | 'driving-traffic' | 'driving',
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
  signal: AbortSignal
): Promise<DirectionsRoute | null> {
  const formattedUrl =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${fromLng},${fromLat};${toLng},${toLat}?` +
    `geometries=geojson&overview=full&steps=true&access_token=${MAPBOX_TOKEN}`;
  const response = await fetch(formattedUrl, { signal });
  if (!response.ok) return null;
  const data = await response.json();
  return data.routes?.[0] ?? null;
}

async function drawRoute(
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
  controller: AbortController
) {
  const lifecycle = activeMapLifecycle;
  const straightLineKm = haversine(fromLat, fromLng, toLat, toLng);
  const mode = getTravelMode(straightLineKm);

  travelVisualization?.clear();
  if (mode === 'flight') {
    if (
      controller.signal.aborted ||
      activeMapLifecycle !== lifecycle ||
      routeRequestController !== controller
    )
      return;
    travelVisualization?.showFlight([fromLng, fromLat], [toLng, toLat]);
    const illustrativeHours = Math.max(1, straightLineKm / 800 + 0.75);
    updateRouteInfo(
      'flight',
      `Illustrative flight · ~${illustrativeHours.toFixed(1)} hr · ${formatDistance(straightLineKm)}`
    );
    const unwrappedToLng = toLng + Math.round((fromLng - toLng) / 360) * 360;
    fitTravelBounds(
      [
        [fromLng, fromLat],
        [unwrappedToLng, toLat],
      ],
      5
    );
    if (routeRequestController === controller) routeRequestController = null;
    return;
  }

  try {
    const profile = mode === 'walking' ? 'walking' : 'driving-traffic';
    let route = await fetchDirectionsRoute(
      profile,
      fromLng,
      fromLat,
      toLng,
      toLat,
      controller.signal
    );
    if (
      activeMapLifecycle !== lifecycle ||
      controller.signal.aborted ||
      routeRequestController !== controller
    )
      return;
    if (!route && mode === 'driving') {
      route = await fetchDirectionsRoute(
        'driving',
        fromLng,
        fromLat,
        toLng,
        toLat,
        controller.signal
      );
      if (
        activeMapLifecycle !== lifecycle ||
        controller.signal.aborted ||
        routeRequestController !== controller
      )
        return;
    }
    if (!route) {
      alert(`No ${mode} route found.`);
      return;
    }

    const durationMin = Math.round(route.duration / 60);
    const distanceKm = (route.distance / 1000).toFixed(1);
    const coordinates = route.geometry.coordinates as [number, number][];
    travelVisualization?.showRoute(mode, coordinates);
    updateRouteInfo(
      mode,
      `${durationMin} min ${mode === 'walking' ? 'walk' : 'drive'} · ${distanceKm} km`
    );
    fitTravelBounds(coordinates, mode === 'walking' ? 17 : 14);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    console.warn('[TuriMap] Route error:', err);
    alert('Could not calculate route. Try again.');
  } finally {
    if (routeRequestController === controller) routeRequestController = null;
  }
}

async function drawMultiStopRoute(
  coordinates: [number, number][],
  signal?: AbortSignal
) {
  if (coordinates.length < 2) return;
  const lifecycle = activeMapLifecycle;
  const waypointString = coordinates.map((c) => `${c[0]},${c[1]}`).join(';');
  const formattedUrl =
    `https://api.mapbox.com/directions/v5/mapbox/walking/${waypointString}?` +
    `geometries=geojson&overview=full&steps=true&access_token=${MAPBOX_TOKEN}`;

  try {
    const res = await fetch(formattedUrl, { signal });
    if (!res.ok) throw new Error('Directions API error');
    const data = await res.json();
    if (signal?.aborted || activeMapLifecycle !== lifecycle) return;
    const route = data.routes?.[0];
    if (!route) {
      alert('No walking route found.');
      return;
    }

    const geojson = route.geometry;
    const durationMin = Math.round(route.duration / 60);
    const distanceKm = (route.distance / 1000).toFixed(1);

    travelVisualization?.clear();
    travelVisualization?.showRoute(
      'walking',
      geojson.coordinates as [number, number][]
    );

    // Show route info bar
    updateRouteInfo('walking', `${durationMin} min walk · ${distanceKm} km`);

    // Fit map to show entire route
    const coords = geojson.coordinates as [number, number][];
    const bounds = new mapboxgl.LngLatBounds();
    coords.forEach((c: [number, number]) => bounds.extend(c));
    map.fitBounds(bounds, {
      padding: { top: 120, bottom: 200, left: 60, right: 60 },
      maxZoom: 17,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    console.warn('[TuriMap] Route error:', err);
    alert('Could not calculate route. Try again.');
  }
}

function clearRoute() {
  routeRequestController?.abort();
  routeRequestController = null;
  travelVisualization?.clear();

  const routeInfo = $('route-info');
  if (routeInfo) routeInfo.classList.add('hidden');
}

function deselect() {
  selectedPlace = null;
  const vrContainer = document.getElementById('detail-vr-container');
  const vrIframe = document.getElementById(
    'detail-vr-iframe'
  ) as HTMLIFrameElement | null;
  if (vrIframe) vrIframe.src = '';
  if (vrContainer) vrContainer.classList.add('hidden');

  // Rebuild the index so the previously selected place rejoins its cluster.
  refreshClusteredPins();
  clearRoute();
  $('view-detail')?.classList.add('hidden');
  $('view-list')?.classList.remove('hidden');
  isCollapsed = true;
  updateSheetUI();
}

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------
type GeoState = 'ok' | 'error' | 'loading';

const setGeo = (state: GeoState, msg: string) => {
  const dot = $('geo-dot');
  const geoText = $('geo-text');
  if (!dot || !geoText) return;
  dot.className = `h-2 w-2 rounded-full ${
    state === 'ok'
      ? 'bg-emerald-400'
      : state === 'error'
        ? 'bg-red-400'
        : 'bg-amber-400 animate-pulse'
  }`;
  geoText.textContent = msg;
};

let firstLocationFetched = false;
let permissionDenied = false;

function updateUserMarker(lng: number, lat: number) {
  if (userMarker) {
    userMarker.setLngLat([lng, lat]);
  } else {
    const el = document.createElement('div');
    el.className = 'user-dot';
    userMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(map);
  }
}

const onPos = async (pos: GeolocationPosition) => {
  const { latitude: lat, longitude: lng } = pos.coords;
  userLat = lat;
  userLng = lng;
  permissionDenied = false;

  safeSet('turimap_user_lat', lat.toString());
  safeSet('turimap_user_lng', lng.toString());

  const currentLifecycle = activeMapLifecycle;
  updateUserMarker(lng, lat);
  setGeo('ok', 'Location active');

  if (!firstLocationFetched) {
    firstLocationFetched = true;
    if (activeMapLifecycle !== currentLifecycle) return;
  }
};

const onErr = (err: GeolocationPositionError) => {
  if (err.code === 1) {
    permissionDenied = true;
    setGeo('error', 'Permission denied');
  } else {
    setGeo('error', 'No signal');
  }
};

function startWatching() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  if (!('geolocation' in navigator)) {
    setGeo('error', 'GPS not supported');
    return;
  }
  setGeo('loading', 'Locating...');
  watchId = navigator.geolocation.watchPosition(onPos, onErr, {
    enableHighAccuracy: false,
    maximumAge: 60000,
    timeout: 10000,
  });
}

function requestLocationPermission() {
  if (!('geolocation' in navigator)) return;
  if (permissionDenied) {
    alert(
      'Location access is disabled.\n\n1. Tap the lock icon next to the URL.\n2. Change Location to "Allow".\n3. Reload the page.'
    );
    return;
  }
  setGeo('loading', 'Locating...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      onPos(pos);
      startWatching();
    },
    (err) => {
      onErr(err);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ---------------------------------------------------------------------------
// Lifecycle: Setup & Tear Down Map (Astro View Transitions support)
// ---------------------------------------------------------------------------
const DEFAULT_CENTER: [number, number] = [-99.1332, 19.4326]; // CDMX fallback
let searchDebounce: ReturnType<typeof setTimeout> | null = null;
let refreshDebounce: ReturnType<typeof setTimeout> | null = null;
let searchAbortController: AbortController | null = null;
let nearbyRequestController: AbortController | null = null;
let routeRequestController: AbortController | null = null;
let aiRouteHandler: ((event: Event) => void) | null = null;
let searchRequestSequence = 0;
let mapLifecycleSequence = 0;
let activeMapLifecycle = 0;
let resizeHandler: (() => void) | null = null;
let documentClickHandler: ((event: MouseEvent) => void) | null = null;

function getCurrentViewport(): {
  center: { lng: number; lat: number };
  viewport: PaddedViewport;
  budget: PoiBudget;
  cacheKey: string;
} | null {
  const bounds = map.getBounds();
  if (!bounds) return null;
  const center = map.getCenter();
  const container = map.getContainer();
  const budget = getPoiBudget(
    map.getZoom(),
    container.clientWidth * container.clientHeight
  );
  const viewport = createPaddedViewport({
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  });
  return {
    center,
    viewport,
    budget,
    cacheKey: `${getViewportCacheKey(viewport, budget.zoomBucket)}:${budget.apiLimit}`,
  };
}

async function refreshNearbyPlacesForViewport(
  lifecycle: number,
  showLoading = false
): Promise<void> {
  const searchInput = $<HTMLInputElement>('search-input');
  if (
    activeMapLifecycle !== lifecycle ||
    isMapRemoved() ||
    searchInput?.value.trim()
  )
    return;
  const context = getCurrentViewport();
  if (!context) return;

  // Hard zoom gate: below MIN_POI_ZOOM no fetch, no pins — only the hint.
  // Abort any in-flight request so it cannot re-render stale pins.
  if (!shouldLoadPois(map.getZoom())) {
    nearbyRequestController?.abort();
    nearbyRequestController = null;
    clearPlaceMarkers();
    nearbyPlaces = [];
    // Keep the cluster index consistent with the emptied data set.
    refreshClusteredPins();
    renderZoomGateHint();
    lastRenderedCacheKey = 'below-zoom';
    return;
  }

  // No-op guard: same quantized viewport → skip fetch, merge and DOM rebuild.
  if (context.cacheKey === lastRenderedCacheKey) return;

  const loadingEl = $('places-loading');
  if (showLoading) loadingEl?.classList.remove('hidden');
  nearbyRequestController?.abort();
  const controller = new AbortController();
  nearbyRequestController = controller;

  try {
    const places = await fetchNearbyPlaces(
      context.center.lng,
      context.center.lat,
      context.viewport,
      context.budget,
      context.cacheKey,
      controller.signal
    );
    if (
      activeMapLifecycle !== lifecycle ||
      controller.signal.aborted ||
      nearbyRequestController !== controller
    )
      return;
    nearbyPlaces = getMergedNearbyPlaces(
      places,
      context.center.lng,
      context.center.lat,
      context.viewport,
      Math.min(context.budget.renderLimit, MAX_RENDERED_POIS)
    );
    renderList(getFilteredPlaces(nearbyPlaces));
    refreshClusteredPins();
    lastRenderedCacheKey = context.cacheKey;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    console.warn('[TuriMap] Viewport POI refresh failed:', err);
  } finally {
    if (nearbyRequestController === controller) nearbyRequestController = null;
    if (activeMapLifecycle === lifecycle && showLoading) {
      loadingEl?.classList.add('hidden');
    }
  }
}

type IdleCapableWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number }
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

function cancelDetailed3DUpgrade(): void {
  if (detailed3DDelay !== null) {
    clearTimeout(detailed3DDelay);
    detailed3DDelay = null;
  }
  if (detailed3DIdleHandle !== null) {
    (window as IdleCapableWindow).cancelIdleCallback?.(detailed3DIdleHandle);
    detailed3DIdleHandle = null;
  }
}

function scheduleDetailed3DUpgrade(lifecycle: number): void {
  cancelDetailed3DUpgrade();

  // Wait until the lightweight base map, visible tiles and initial markers are
  // stable. Mapbox then streams the detailed 3D data into the same canvas.
  map.once('idle', () => {
    if (
      activeMapLifecycle !== lifecycle ||
      currentStyleIdx !== 0 ||
      detailed3DEnabled
    )
      return;

    const enableDetailed3D = () => {
      detailed3DDelay = null;
      detailed3DIdleHandle = null;
      if (
        activeMapLifecycle !== lifecycle ||
        currentStyleIdx !== 0 ||
        detailed3DEnabled
      )
        return;

      try {
        window.dispatchEvent(new CustomEvent('map:3d-detail-loading'));
        map.setConfigProperty('basemap', 'show3dObjects', true);
        detailed3DEnabled = true;
        map.once('idle', () => {
          if (activeMapLifecycle === lifecycle && detailed3DEnabled) {
            window.dispatchEvent(new CustomEvent('map:3d-detail-ready'));
          }
        });
      } catch (error) {
        console.warn(
          '[TuriMap] Detailed 3D upgrade could not be enabled:',
          error
        );
      }
    };

    // Give initial gestures, pins and location updates priority. Safari has no
    // requestIdleCallback, so it receives the equivalent delayed fallback.
    detailed3DDelay = setTimeout(
      () => {
        detailed3DDelay = null;
        const idleWindow = window as IdleCapableWindow;
        if (idleWindow.requestIdleCallback) {
          detailed3DIdleHandle = idleWindow.requestIdleCallback(
            enableDetailed3D,
            {
              timeout: isLowPowerDevice ? 6000 : 2500,
            }
          );
        } else {
          enableDetailed3D();
        }
      },
      isLowPowerDevice ? 1200 : 180
    );
  });
}

function createCirclePolygon(
  centerLng: number,
  centerLat: number,
  radiusMeters: number,
  points = 36
): [number, number][] {
  const coords: [number, number][] = [];
  const km = radiusMeters / 1000;
  const distanceX = km / (111.32 * Math.cos((centerLat * Math.PI) / 180));
  const distanceY = km / 110.574;

  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    coords.push([centerLng + x, centerLat + y]);
  }
  coords.push(coords[0]);
  return coords;
}

function buildRecintosGeoJSON(): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  // Zone prose is localized here, so the layer must be rebuilt on locale change.
  const locale = detectLocale();
  const features: GeoJSON.Feature<GeoJSON.Geometry>[] = RECINTOS.map((r) => {
    // A real boundary is always preferred. The circle is a documented
    // approximation for the few zones with no published public geometry.
    const hasRealBoundary = Boolean(r.polygon && r.polygon.length >= 3);

    /** Converts a stored [lat, lng] ring into a closed GeoJSON [lng, lat] ring. */
    const toGeoRing = (ring: [number, number][]): [number, number][] => {
      const coords: [number, number][] = ring.map(([lat, lng]) => [lng, lat]);
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([first[0], first[1]]);
      }
      return coords;
    };

    // Zones can be made of disjoint parts (Chapultepec's 4th section is
    // detached), so build a MultiPolygon whenever extra rings exist.
    const rings: [number, number][][] = hasRealBoundary
      ? [
          toGeoRing(r.polygon as [number, number][]),
          ...(r.polygons ?? [])
            .filter((ring) => ring.length >= 3)
            .map(toGeoRing),
        ]
      : [
          createCirclePolygon(
            r.lng,
            r.lat,
            r.radiusMeters ?? RECINTO_DEFAULT_RADIUS[r.type] ?? 250
          ),
        ];

    const typeColor = RECINTO_TYPES[r.type]?.color || '#a16207';

    return {
      type: 'Feature',
      properties: {
        id: r.id,
        name: r.name,
        type: r.type,
        typeLabel: trMapa(
          RECINTO_TYPE_I18N_KEY[r.type],
          RECINTO_TYPES[r.type]?.label ?? r.type
        ),
        era: pickLocalized(r, 'era', locale),
        fact: pickLocalized(r, 'fact', locale),
        shortDesc: pickLocalized(r, 'shortDesc', locale),
        emoji: r.emoji,
        color: typeColor,
        lat: r.lat,
        lng: r.lng,
        foundedYear: r.foundedYear,
        wikipediaUrl: r.wikipediaUrl,
        approximate: !hasRealBoundary,
        attribution: hasRealBoundary ? r.geometrySource?.osm : undefined,
      },
      geometry:
        rings.length > 1
          ? {
              type: 'MultiPolygon',
              coordinates: rings.map((ring) => [ring]),
            }
          : {
              type: 'Polygon',
              coordinates: [rings[0]],
            },
    };
  });

  return {
    type: 'FeatureCollection',
    features,
  };
}

/** Bounds of a GeoJSON Polygon ring, used to frame a zone without zooming to a pin. */
/** Outer rings of a Polygon or MultiPolygon, as [lng, lat]. */
function geometryOuterRings(geometry: GeoJSON.Geometry): [number, number][][] {
  if (geometry.type === 'Polygon') {
    const [ring] = geometry.coordinates as [number, number][][];
    return ring?.length ? [ring] : [];
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as [number, number][][][])
      .map((polygon) => polygon[0])
      .filter((ring): ring is [number, number][] => Boolean(ring?.length));
  }
  return [];
}

function polygonBounds(
  geometry: GeoJSON.Geometry
): mapboxgl.LngLatBounds | null {
  const rings = geometryOuterRings(geometry);
  if (!rings.length) return null;
  const bounds = new mapboxgl.LngLatBounds();
  for (const ring of rings) {
    for (const [lng, lat] of ring) bounds.extend([lng, lat]);
  }
  return bounds;
}

interface ZoneCardData {
  id: string;
  name: string;
  typeLabel: string;
  era: string;
  shortDesc: string;
  fact: string;
  emoji: string;
  color: string;
  foundedYear?: number;
  wikipediaUrl?: string;
  approximate: boolean;
  attribution?: string;
  bounds: mapboxgl.LngLatBounds | null;
  lat: number;
  lng: number;
  /** Outer rings as [lng, lat], used for point-in-polygon place lookup. */
  rings: [number, number][][];
}

let activeZone: ZoneCardData | null = null;
let zonePopup: mapboxgl.Popup | null = null;
const zoneMarkers: Marker[] = [];

/**
 * Ray-casting point-in-polygon. Ring is [lng, lat] and assumed closed.
 * Good enough at city scale; zones are small relative to Earth curvature.
 */
function isPointInRing(
  lng: number,
  lat: number,
  ring: [number, number][]
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Area centroid of a closed [lng, lat] ring.
 *
 * Needed because the stored lat/lng comes from Wikipedia and for 3 of 26 real
 * boundaries (San Felipe de Jesús, Condesa, San Ángel) it falls OUTSIDE the
 * zone's own polygon — anchoring the label there would place the zone's marker
 * outside the zone. The polygon centroid is inside for all 26.
 */
function ringCentroid(ring: [number, number][]): [number, number] | null {
  if (ring.length < 4) return null;
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }
  area /= 2;
  if (!area) return null;
  return [x / (6 * area), y / (6 * area)];
}

/** Places currently loaded that actually fall inside the zone's boundary. */
function placesInsideZone(zone: ZoneCardData): Place[] {
  const rings = zone.rings.filter((ring) => ring.length >= 4);
  if (!rings.length) return [];
  return getFilteredPlaces(nearbyPlaces).filter(
    (place) =>
      place.category !== 'route' &&
      // A multi-part zone counts a place inside ANY of its parts.
      rings.some((ring) => isPointInRing(place.lng, place.lat, ring))
  );
}

function renderZonePlaces(zone: ZoneCardData) {
  const wrap = $('zone-card-places-wrap');
  const list = $('zone-card-places');
  const empty = $('zone-card-places-empty');
  const count = $('zone-card-places-count');
  if (!wrap || !list) return;

  // Only meaningful for real boundaries — a fallback circle would imply
  // membership that the data does not actually support.
  if (zone.approximate) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');

  const places = placesInsideZone(zone);
  if (count) count.textContent = places.length ? `(${places.length})` : '';
  empty?.classList.toggle('hidden', places.length > 0);

  list.textContent = '';
  for (const place of places.slice(0, 12)) {
    const info = getCategoryInfo(place.category);
    const row = document.createElement('button');
    row.type = 'button';
    row.className =
      'flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-black/[0.05] dark:hover:bg-white/10';
    const icon = document.createElement('span');
    icon.className = 'text-sm leading-none';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = place.emoji || info.emoji;
    const label = document.createElement('span');
    label.className =
      'min-w-0 flex-1 truncate text-xs font-medium text-slate-700 dark:text-slate-200';
    label.textContent = place.name;
    row.append(icon, label);
    if (place.distance !== undefined) {
      const distance = document.createElement('span');
      distance.className =
        'shrink-0 text-[10px] font-semibold text-slate-400 dark:text-slate-500';
      distance.textContent = formatDistance(place.distance);
      row.append(distance);
    }
    // Selecting a place from the list is a pin action, so the pin flow is
    // correct here — but close the zone card first so they don't stack.
    row.addEventListener('click', () => {
      hideZoneCard();
      selectPlace(place);
    });
    list.append(row);
  }
}

function fitZoneBounds(zone: ZoneCardData) {
  if (!zone.bounds || isMapRemoved()) return;
  // Frame the whole area. Deliberately NOT flyTo/zoom-17: a zone is a region,
  // and the card stays anchored at the top, so pad for it.
  map.fitBounds(zone.bounds, {
    padding: { top: 260, bottom: 120, left: 48, right: 48 },
    maxZoom: 16,
    duration: 900,
  });
}

function hideZoneCard() {
  activeZone = null;
  const card = $('zone-card');
  if (card) {
    card.classList.add('hidden');
    // Return the template to the page so the popup can be torn down safely.
    if (card.parentElement !== document.body) document.body.append(card);
  }
  for (const marker of zoneMarkers) {
    marker.getElement().classList.remove('active');
  }
  zonePopup?.remove();
  zonePopup = null;
}

/**
 * Anchors the card to the zone's own coordinates via a Mapbox Popup, so it
 * reads as a pin over the area rather than a panel pinned to the viewport.
 */
function attachZoneCard(zone: ZoneCardData, card: HTMLElement) {
  if (isMapRemoved()) return;
  zonePopup?.remove();
  zonePopup = new mapboxgl.Popup({
    closeButton: false,
    // Clicking the map elsewhere should dismiss it, like any pin popup.
    closeOnClick: true,
    closeOnMove: false,
    maxWidth: 'none',
    offset: 18,
    className: 'zone-popup',
    // No fixed anchor: let Mapbox flip the card to whichever side keeps it on
    // screen. Forcing 'bottom' pushed it off the top edge near the viewport top,
    // which is what made it hard to read.
  })
    .setLngLat([zone.lng, zone.lat])
    .setDOMContent(card)
    .addTo(map);

  zonePopup.on('close', () => {
    // Keep our state in sync when Mapbox closes the popup itself.
    if (activeZone?.id === zone.id) hideZoneCard();
  });

  // Pan just enough to bring the whole card into view, accounting for the
  // search/chips layer on top and the bottom sheet below.
  ensureZoneCardVisible(card);
}

/**
 * Nudges the map so the popup card is fully visible. Mapbox only flips the
 * anchor; it does not scroll the map, so a card near an edge can still be
 * clipped by our own floating chrome.
 */
function ensureZoneCardVisible(card: HTMLElement) {
  if (isMapRemoved()) return;
  requestAnimationFrame(() => {
    if (isMapRemoved() || !card.isConnected) return;
    const container = map.getContainer().getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // Reserve room for the top search + filter chips and the bottom sheet.
    const topInset = 132;
    const bottomInset = 148;
    const margin = 12;

    let panX = 0;
    let panY = 0;
    const overflowTop = container.top + topInset - rect.top + margin;
    const overflowBottom =
      rect.bottom - (container.bottom - bottomInset) + margin;
    const overflowLeft = container.left - rect.left + margin;
    const overflowRight = rect.right - container.right + margin;

    // Vertical: prefer fixing the top edge, since the card grows upward.
    if (overflowTop > 0) panY = -overflowTop;
    else if (overflowBottom > 0) panY = overflowBottom;

    if (overflowLeft > 0) panX = -overflowLeft;
    else if (overflowRight > 0) panX = overflowRight;

    if (panX === 0 && panY === 0) return;
    map.panBy([panX, panY], { duration: 320 });
  });
}

function showZoneCard(zone: ZoneCardData) {
  const card = $('zone-card');
  if (!card) return;
  // Tear down any previous popup before re-parenting the shared template.
  hideZoneCard();
  activeZone = zone;

  const setText = (id: string, value: string) => {
    const el = $(id);
    if (el) el.textContent = value;
  };

  const accent = $('zone-card-accent');
  if (accent) accent.style.backgroundColor = zone.color;

  setText('zone-card-emoji', zone.emoji || '🏛️');
  setText('zone-card-kind', zone.typeLabel);
  setText('zone-card-name', zone.name);
  setText(
    'zone-card-meta',
    [
      zone.era,
      zone.foundedYear
        ? trMapa('mapa.zone.founded', 'Since {year}').replace(
            '{year}',
            String(zone.foundedYear)
          )
        : '',
    ]
      .filter(Boolean)
      .join(' · ')
  );
  setText('zone-card-desc', zone.shortDesc);

  const factWrap = $('zone-card-fact-wrap');
  if (factWrap) {
    if (zone.fact) {
      setText('zone-card-fact', zone.fact);
      factWrap.classList.remove('hidden');
    } else {
      factWrap.classList.add('hidden');
    }
  }

  // Only ever shown for the documented circle fallbacks.
  $('zone-card-approx')?.classList.toggle('hidden', !zone.approximate);

  const wiki = $('zone-card-wiki') as HTMLAnchorElement | null;
  if (wiki) {
    if (zone.wikipediaUrl) {
      wiki.href = zone.wikipediaUrl;
      wiki.classList.remove('hidden');
    } else {
      wiki.classList.add('hidden');
    }
  }

  $('zone-card-fit')?.classList.toggle('hidden', !zone.bounds);

  setText(
    'zone-card-attrib',
    zone.attribution
      ? `${trMapa('mapa.zone.source', 'Boundaries © OpenStreetMap contributors (ODbL)')} · ${zone.attribution}`
      : ''
  );

  renderZonePlaces(zone);

  card.classList.remove('hidden');
  attachZoneCard(zone, card);

  for (const marker of zoneMarkers) {
    const element = marker.getElement();
    element.classList.toggle('active', element.dataset.zoneId === zone.id);
  }
}

/** Builds the zone data the card needs from a rendered zone feature. */
function zoneDataFromFeature(
  properties: Record<string, unknown>,
  geometry: GeoJSON.Geometry
): ZoneCardData {
  const rings = geometryOuterRings(geometry);
  return {
    id: String(properties.id),
    name: String(properties.name ?? ''),
    typeLabel: String(properties.typeLabel ?? properties.type ?? ''),
    era: String(properties.era ?? ''),
    shortDesc: String(properties.shortDesc ?? ''),
    fact: String(properties.fact ?? ''),
    emoji: String(properties.emoji ?? '🏛️'),
    color: String(properties.color ?? '#a16207'),
    foundedYear:
      properties.foundedYear === undefined || properties.foundedYear === null
        ? undefined
        : Number(properties.foundedYear),
    wikipediaUrl: properties.wikipediaUrl
      ? String(properties.wikipediaUrl)
      : undefined,
    // Mapbox serializes feature properties, so booleans can arrive as strings.
    approximate:
      properties.approximate === true || properties.approximate === 'true',
    attribution: properties.attribution
      ? String(properties.attribution)
      : undefined,
    bounds: polygonBounds(geometry),
    ...anchorFor(rings, Number(properties.lat), Number(properties.lng)),
    rings,
  };
}

/**
 * Where the zone's marker and popup should sit. Prefers the polygon centroid so
 * the label is always visually inside its own area.
 */
function anchorFor(
  rings: [number, number][][],
  lat: number,
  lng: number
): { lat: number; lng: number } {
  // Anchor to the largest part, so a multi-part zone labels its main body.
  const ring = rings.reduce<[number, number][] | null>(
    (largest, candidate) =>
      !largest || candidate.length > largest.length ? candidate : largest,
    null
  );
  if (!ring) return { lat, lng };
  const centroid = ringCentroid(ring);
  if (centroid && isPointInRing(centroid[0], centroid[1], ring)) {
    return { lng: centroid[0], lat: centroid[1] };
  }
  return { lat, lng };
}

/**
 * Renders one always-visible glass label per zone, matching the pin language.
 * These are what the user reads as "the zone's pin"; tapping one opens the card.
 */
function renderZoneMarkers(
  mapInstance: mapboxgl.Map,
  geojson: GeoJSON.FeatureCollection<GeoJSON.Geometry>
) {
  for (const marker of zoneMarkers) marker.remove();
  zoneMarkers.length = 0;

  for (const feature of geojson.features) {
    const properties = feature.properties as Record<string, unknown> | null;
    if (!properties) continue;
    // Same anchor as the popup, so the label and its card never disagree.
    const zone = zoneDataFromFeature(properties, feature.geometry);
    const { lat, lng } = zone;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const element = document.createElement('div');
    element.className = 'zone-marker';
    element.dataset.zoneId = String(properties.id);
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', String(properties.name ?? 'Zone'));

    const dot = document.createElement('span');
    dot.className = 'zone-marker-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.textContent = String(properties.emoji ?? '🏛️');
    dot.style.backgroundColor = `${String(properties.color ?? '#a16207')}26`;

    const label = document.createElement('span');
    label.className = 'zone-marker-label';
    label.textContent = String(properties.name ?? '');

    element.append(dot, label);

    const open = () => {
      bindZoneCardControls();
      showZoneCard(zone);
    };
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      open();
    });
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });

    zoneMarkers.push(
      new mapboxgl.Marker({ element, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(mapInstance)
    );
  }
}

function bindZoneCardControls() {
  const close = $('zone-card-close');
  if (close && !close.dataset.bound) {
    close.dataset.bound = 'true';
    close.addEventListener('click', hideZoneCard);
  }
  const fit = $('zone-card-fit');
  if (fit && !fit.dataset.bound) {
    fit.dataset.bound = 'true';
    fit.addEventListener('click', () => {
      if (activeZone) fitZoneBounds(activeZone);
    });
  }
}

/**
 * Zone layer state, mirroring the pin layer's loading policy: zones only
 * materialize above MIN_POI_ZOOM and only for the padded viewport, and a cache
 * key skips redundant rebuilds. Without this, all 13 zones (610+ polygon
 * vertices) plus their DOM markers were built on every style load regardless of
 * where the user was looking.
 */
let zoneRenderCacheKey: string | null = null;
/** Full zone GeoJSON, built once and then filtered per viewport. */
let allZonesGeoJSON: GeoJSON.FeatureCollection<GeoJSON.Geometry> | null = null;
/** Locale the cached GeoJSON was built with, so prose updates on switch. */
let zonesGeoJSONLocale: string | null = null;

const EMPTY_ZONE_COLLECTION: GeoJSON.FeatureCollection<GeoJSON.Geometry> = {
  type: 'FeatureCollection',
  features: [],
};

/** Builds (and caches) the full zone collection. Rebuilt only on locale change. */
function getAllZonesGeoJSON(): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  const locale = detectLocale();
  if (!allZonesGeoJSON || zonesGeoJSONLocale !== locale) {
    allZonesGeoJSON = buildRecintosGeoJSON();
    zonesGeoJSONLocale = locale;
  }
  return allZonesGeoJSON;
}

/**
 * Zones whose extent overlaps the padded viewport. A zone is an AREA, so this
 * is a bounding-box intersection, not a vertex test: standing deep inside
 * Chapultepec puts none of its vertices on screen, and a vertex test would make
 * the zone vanish exactly when the user is inside it.
 */
function getZonesInViewport(
  viewport: PaddedViewport
): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  const features = getAllZonesGeoJSON().features.filter((feature) => {
    const rings = geometryOuterRings(feature.geometry);
    if (!rings.length) return false;
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lng < west) west = lng;
        if (lng > east) east = lng;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
    }
    // Latitude never wraps; longitude spans here are far below the 180 deg
    // seam, so a direct interval overlap is safe for CDMX-scale zones.
    return (
      north >= viewport.south &&
      south <= viewport.north &&
      east >= viewport.west &&
      west <= viewport.east
    );
  });
  return { type: 'FeatureCollection', features };
}

function setupRecintosLayer(mapInstance: mapboxgl.Map): void {
  if (!mapInstance) return;

  // Zoom gate: below MIN_POI_ZOOM the zone layer stays empty, exactly like pins.
  const zoomAllows = shouldLoadPois(mapInstance.getZoom());
  const context = zoomAllows ? getCurrentViewport() : null;
  const geojson = context
    ? getZonesInViewport(context.viewport)
    : EMPTY_ZONE_COLLECTION;

  // No-op guard: same quantized viewport → skip marker/DOM rebuild.
  const cacheKey = zoomAllows
    ? `${zonesGeoJSONLocale}:${context?.cacheKey ?? 'none'}`
    : 'below-zoom';
  const sourceExists = Boolean(mapInstance.getSource('recintos-zones'));
  if (sourceExists && cacheKey === zoneRenderCacheKey) return;
  zoneRenderCacheKey = cacheKey;

  renderZoneMarkers(mapInstance, geojson);

  if (mapInstance.getSource('recintos-zones')) {
    (mapInstance.getSource('recintos-zones') as mapboxgl.GeoJSONSource).setData(
      geojson
    );
  } else {
    mapInstance.addSource('recintos-zones', {
      type: 'geojson',
      data: geojson,
    });

    // Find the first building/model/extrusion/label layer to place zone highlights UNDER 3D buildings & labels
    let beforeLayerId: string | undefined;
    const layers = mapInstance.getStyle()?.layers;
    if (layers) {
      for (const layer of layers) {
        if (
          layer.type === 'fill-extrusion' ||
          (layer as { type?: string }).type === 'model' ||
          layer.id === '3d-buildings' ||
          layer.id.includes('building') ||
          layer.id.includes('3d') ||
          (layer.type === 'symbol' &&
            (layer.layout as Record<string, unknown>)?.[`text-field`])
        ) {
          beforeLayerId = layer.id;
          break;
        }
      }
    }

    mapInstance.addLayer(
      {
        id: 'recintos-zones-fill',
        type: 'fill',
        source: 'recintos-zones',
        slot: 'bottom',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.12,
        },
      } as mapboxgl.AnyLayer,
      beforeLayerId
    );

    mapInstance.addLayer(
      {
        id: 'recintos-zones-outline',
        type: 'line',
        source: 'recintos-zones',
        slot: 'bottom',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1.5,
          'line-opacity': 0.5,
          'line-dasharray': [3, 3],
        },
      } as mapboxgl.AnyLayer,
      beforeLayerId
    );

    mapInstance.on('click', 'recintos-zones-fill', (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;
      const props = feature.properties;
      // A zone gets its own card and keeps the map framed on the AREA.
      // It must not go through selectPlace(), which flies to zoom 17 / pitch 55
      // and reframes a whole region as if it were a single pin.
      bindZoneCardControls();
      showZoneCard(
        zoneDataFromFeature(
          props as unknown as Record<string, unknown>,
          feature.geometry
        )
      );
    });

    mapInstance.on('mouseenter', 'recintos-zones-fill', () => {
      mapInstance.getCanvas().style.cursor = 'pointer';
    });

    mapInstance.on('mouseleave', 'recintos-zones-fill', () => {
      mapInstance.getCanvas().style.cursor = '';
    });
  }
}

function initMap() {
  const mapEl = $('map');
  if (!mapEl) return;

  // Clean up any stale map session leftovers
  cleanUpMap();
  const lifecycle = ++mapLifecycleSequence;
  activeMapLifecycle = lifecycle;
  window.dispatchEvent(new CustomEvent('map:mounted'));

  // Resolve current sheet components
  bottomSheet = $('bottom-sheet');
  sheetHeader = $('sheet-header');
  sheetChevron = $('sheet-chevron');
  sheetBody = $('sheet-body');
  floatingControls = $('map-floating-controls');

  // Always load CDMX historic center first
  const initialCenter: [number, number] = DEFAULT_CENTER;

  // Create Mapbox instance
  map = new mapboxgl.Map({
    container: 'map',
    style: STYLES[currentStyleIdx].id,
    center: initialCenter,
    zoom: 15,
    pitch: 45,
    bearing: -17.6,
    antialias: !isLowPowerDevice,
    attributionControl: false,
    fadeDuration: isLowPowerDevice ? 0 : 300,
    maxTileCacheSize: isLowPowerDevice ? 24 : undefined,
    performanceMetricsCollection: false,
    config: {
      basemap: {
        show3dObjects: false,
      },
    },
  });
  travelVisualization = new TravelVisualization(
    map,
    () => activeMapLifecycle === lifecycle && !isMapRemoved()
  );

  scheduleDetailed3DUpgrade(lifecycle);

  // Local data can be drawn as soon as the base map is ready; remote POIs
  // are merged in later without making the user wait on a network request.
  map.once('load', () => {
    setupRecintosLayer(map);
    if (activeMapLifecycle !== lifecycle || nearbyPlaces.length > 0) return;
    if (!shouldLoadPois(map.getZoom())) return;
    const context = getCurrentViewport();
    if (!context) return;
    const localPlaces = getLocalPlaces(
      context.center.lng,
      context.center.lat,
      context.viewport
    ).slice(0, context.budget.renderLimit);
    if (!localPlaces.length) return;
    nearbyPlaces = localPlaces;
    renderList(getFilteredPlaces(localPlaces));
    refreshClusteredPins();
  });

  map.once('idle', () => {
    if (activeMapLifecycle === lifecycle) {
      void refreshNearbyPlacesForViewport(lifecycle, true);
    }
  });

  // Setup style.load hook
  map.on('style.load', () => {
    // A style swap destroys sources and layers, so the cached render key no
    // longer reflects reality — force a rebuild.
    zoneRenderCacheKey = null;
    setupRecintosLayer(map);
    let labelLayerId: string | undefined;
    const layers = map.getStyle().layers;
    if (layers) {
      for (const layer of layers) {
        if (
          layer.type === 'symbol' &&
          (layer.layout as Record<string, unknown>)?.[`text-field`]
        ) {
          labelLayerId = layer.id;
          break;
        }
      }
    }

    // Standard owns its detailed 3D buildings and enables them progressively.
    // Other selectable styles keep the lightweight extrusion fallback.
    if (
      currentStyleIdx !== 0 &&
      !map.getLayer('3d-buildings') &&
      map.getSource('composite')
    ) {
      try {
        map.addLayer(
          {
            id: '3d-buildings',
            source: 'composite',
            'source-layer': 'building',
            filter: ['==', 'extrude', 'true'],
            type: 'fill-extrusion',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': '#aaa',
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'min_height'],
              'fill-extrusion-opacity': 0.5,
            },
          },
          labelLayerId
        );
      } catch {}
    }

    // DOM markers survive style changes; only style-bound travel resources need restoration.
    travelVisualization?.restoreAfterStyleLoad();
  });

  // Setup interactive map actions
  map.on('movestart', () => {
    window.dispatchEvent(new CustomEvent('map:interaction-start'));
  });

  // Cluster re-render is decoupled from the fetch pipeline: zooming regroups
  // pins even when the viewport no-op guard skips refetching. Signature-guarded.
  map.on('zoomend', () => {
    if (activeMapLifecycle !== lifecycle) return;
    renderClusteredPins();
  });

  map.on('moveend', () => {
    if (activeMapLifecycle !== lifecycle) return;
    window.dispatchEvent(new CustomEvent('map:interaction-end'));
    renderClusteredPins();
    // Zones follow the same viewport policy as pins; the cache key inside
    // setupRecintosLayer makes this a no-op when nothing relevant changed.
    setupRecintosLayer(map);
    if (refreshDebounce) clearTimeout(refreshDebounce);
    refreshDebounce = setTimeout(async () => {
      refreshDebounce = null;
      await refreshNearbyPlacesForViewport(lifecycle);
    }, MOVEEND_REFRESH_DEBOUNCE_MS);
  });

  map.on('click', () => {
    if (selectedPlace) deselect();
  });

  // Render sheet heights
  updateSheetUI();
  resizeHandler = () => {
    if (activeMapLifecycle === lifecycle) updateSheetUI();
  };
  window.addEventListener('resize', resizeHandler);

  // Attach DOM Listeners dynamically to current page nodes
  sheetHeader?.addEventListener('click', () => {
    isCollapsed = !isCollapsed;
    updateSheetUI();
  });

  bottomSheet?.addEventListener('click', (e) => e.stopPropagation());
  $('btn-cancel-route')?.addEventListener('click', () => clearRoute());
  $('btn-close-detail')?.addEventListener('click', deselect);

  const sInput = $<HTMLInputElement>('search-input');
  const searchClear = $('map-search-clear');
  const suggestionsEl = $('search-suggestions');
  let activeSuggestionIndex = -1;

  const setSearchClearVisible = (visible: boolean) => {
    searchClear?.classList.toggle('hidden', !visible);
    searchClear?.classList.toggle('flex', visible);
  };

  function closeSuggestions() {
    if (suggestionsEl) {
      suggestionsEl.classList.add('hidden');
      suggestionsEl.innerHTML = '';
    }
    activeSuggestionIndex = -1;
  }

  function highlightSuggestion(
    items: NodeListOf<HTMLButtonElement>,
    index: number
  ) {
    items.forEach((item, idx) => {
      if (idx === index) {
        item.classList.add('bg-slate-150', 'dark:bg-slate-800');
        item.focus();
      } else {
        item.classList.remove('bg-slate-150', 'dark:bg-slate-800');
      }
    });
  }

  function selectSearchedPlace(place: Place) {
    const exists = nearbyPlaces.some((p) => p.id === place.id);
    if (!exists) {
      nearbyPlaces = [place, ...nearbyPlaces].slice(0, MAX_RENDERED_POIS);
      renderList(getFilteredPlaces(nearbyPlaces));
      refreshClusteredPins();
    }
    selectPlace(place);
    closeSuggestions();
    if (sInput) {
      sInput.value = place.name;
      setSearchClearVisible(true);
    }
  }

  if (sInput) {
    sInput.value = '';
    setSearchClearVisible(false);

    searchClear?.addEventListener('click', () => {
      sInput.value = '';
      setSearchClearVisible(false);
      sInput.dispatchEvent(new Event('input'));
      sInput.focus();
    });

    sInput.addEventListener('keydown', (e) => {
      if (!suggestionsEl || suggestionsEl.classList.contains('hidden')) return;
      const items = suggestionsEl.querySelectorAll<HTMLButtonElement>(
        'button.suggestion-item'
      );
      if (items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
        highlightSuggestion(items, activeSuggestionIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeSuggestionIndex =
          (activeSuggestionIndex - 1 + items.length) % items.length;
        highlightSuggestion(items, activeSuggestionIndex);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeSuggestionIndex >= 0 && items[activeSuggestionIndex]) {
          items[activeSuggestionIndex].click();
        }
      } else if (e.key === 'Escape') {
        closeSuggestions();
      }
    });

    sInput.addEventListener('focus', () => {
      if (sInput.value.trim()) {
        sInput.dispatchEvent(new Event('input'));
      }
    });

    sInput.addEventListener('input', () => {
      const q = sInput.value.trim();
      setSearchClearVisible(Boolean(q));
      if (!q) {
        closeSuggestions();
        void refreshNearbyPlacesForViewport(lifecycle, true);
        return;
      }

      nearbyRequestController?.abort();
      nearbyRequestController = null;
      if (searchDebounce) clearTimeout(searchDebounce);
      searchAbortController?.abort();
      const requestSequence = ++searchRequestSequence;
      searchDebounce = setTimeout(async () => {
        searchDebounce = null;
        if (
          activeMapLifecycle !== lifecycle ||
          requestSequence !== searchRequestSequence
        )
          return;
        const queryLower = q.toLowerCase();
        const locale = detectLocale();

        const mapCenter = map.getCenter();
        const isViewingCDMX =
          haversine(mapCenter.lat, mapCenter.lng, 19.4326, -99.1332) <= 100;
        const isUserLocal =
          userLat !== null &&
          userLng !== null &&
          haversine(userLat, userLng, 19.4326, -99.1332) <= 100;
        const isCDMXActive = isUserLocal || isViewingCDMX;

        const localMatches = isCDMXActive
          ? MONUMENTS.filter((m) => {
              const name = pickLocalized(m, 'name', locale).toLowerCase();
              const desc = pickLocalized(m, 'desc', locale).toLowerCase();
              const cat = pickLocalized(m, 'category', locale).toLowerCase();
              return (
                name.includes(queryLower) ||
                desc.includes(queryLower) ||
                cat.includes(queryLower)
              );
            }).map((m) => {
              const distKm =
                userLat && userLng
                  ? haversine(userLat, userLng, m.lat, m.lng)
                  : undefined;
              return {
                id: m.id,
                name: pickLocalized(m, 'name', locale),
                category: normalizeCategory(m.type || 'monument'),
                address: pickLocalized(m, 'desc', locale),
                lat: m.lat,
                lng: m.lng,
                distance: distKm,
                isLocalMonument: true,
                emoji: m.emoji || '🏛️',
              };
            })
          : [];

        let mapboxMatches: Place[] = [];
        if (q.length >= 2) {
          const proximity =
            userLng && userLat ? `&proximity=${userLng},${userLat}` : '';
          const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?types=poi,place${proximity}&limit=5&language=${locale}&access_token=${MAPBOX_TOKEN}`;
          const controller = new AbortController();
          searchAbortController = controller;
          try {
            const res = await fetch(url, { signal: controller.signal });
            const data = await res.json();
            if (
              activeMapLifecycle !== lifecycle ||
              requestSequence !== searchRequestSequence ||
              controller.signal.aborted
            )
              return;
            mapboxMatches = (data.features || []).map(
              (f: MapboxGeocodingFeature, i: number) => {
                const [fLng, fLat] = f.center;
                const distKm =
                  userLat && userLng
                    ? haversine(userLat, userLng, fLat, fLng)
                    : undefined;
                return {
                  id: f.id || `search-${i}`,
                  name: f.text || f.place_name,
                  category: normalizeCategory(f.properties?.category),
                  address: f.place_name || '',
                  lat: fLat,
                  lng: fLng,
                  distance: distKm,
                  isLocalMonument: false,
                  emoji: '📍',
                };
              }
            );
          } catch (err) {
            if (!(err instanceof DOMException && err.name === 'AbortError')) {
              console.warn('[TuriMap] Search failed:', err);
            }
          } finally {
            if (searchAbortController === controller)
              searchAbortController = null;
          }
        }

        if (
          activeMapLifecycle !== lifecycle ||
          requestSequence !== searchRequestSequence
        )
          return;

        const displayLocalMatches = isUserLocal ? localMatches : [];
        let displayMapboxMatches = mapboxMatches;

        if (!isUserLocal && localMatches.length > 0) {
          displayMapboxMatches = [
            ...localMatches.map((m) => ({
              ...m,
              isLocalMonument: false,
              emoji: '🏛️',
            })),
            ...mapboxMatches,
          ];
        }

        if (
          displayLocalMatches.length === 0 &&
          displayMapboxMatches.length === 0
        ) {
          if (suggestionsEl) {
            suggestionsEl.innerHTML = `<div class="p-4 text-center text-xs text-slate-400 dark:text-slate-500">No results found</div>`;
            suggestionsEl.classList.remove('hidden');
          }
          return;
        }

        let suggestionsHtml = '<div class="py-1.5">';

        if (displayLocalMatches.length > 0) {
          suggestionsHtml += `
            <div>
              <div class="text-[9px] font-bold text-accent-500 dark:text-accent-400 uppercase tracking-wider px-3.5 py-1 select-none">
                Local landmarks
              </div>
              <div class="flex flex-col">
          `;
          displayLocalMatches.forEach((m) => {
            suggestionsHtml += `
              <button
                type="button"
                class="suggestion-item w-full flex items-center gap-3 px-3.5 py-2 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-all text-left group outline-none focus:bg-slate-150 dark:focus:bg-slate-800"
                data-place-id="${m.id}"
                data-place-type="local"
              >
                <span class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-lg group-hover:scale-105 transition-transform">
                  ${m.emoji}
                </span>
                <div class="min-w-0 flex-grow">
                  <div class="flex items-center justify-between gap-2">
                    <p class="truncate text-[12px] font-bold text-slate-800 dark:text-white group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors">${m.name}</p>
                    ${m.distance ? `<span class="text-[9px] font-bold text-slate-500 whitespace-nowrap">${formatDistance(m.distance)}</span>` : ''}
                  </div>
                  <p class="truncate text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">${m.address}</p>
                </div>
              </button>
            `;
          });
          suggestionsHtml += `</div></div>`;
        }

        if (displayMapboxMatches.length > 0) {
          const borderClass =
            displayLocalMatches.length > 0
              ? 'border-t border-slate-200/50 dark:border-slate-800/50 mt-1.5 pt-1.5'
              : '';
          suggestionsHtml += `
            <div class="${borderClass}">
              <div class="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-3.5 py-1 select-none">
                Other places
              </div>
              <div class="flex flex-col">
          `;
          displayMapboxMatches.forEach((m) => {
            suggestionsHtml += `
              <button
                type="button"
                class="suggestion-item w-full flex items-center gap-3 px-3.5 py-2 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-all text-left group outline-none focus:bg-slate-150 dark:focus:bg-slate-800"
                data-place-id="${m.id}"
                data-place-type="${m.isLocalMonument ? 'local' : 'mapbox'}"
              >
                <span class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-lg group-hover:scale-105 transition-transform">
                  ${m.emoji}
                </span>
                <div class="min-w-0 flex-grow">
                  <div class="flex items-center justify-between gap-2">
                    <p class="truncate text-[12px] font-bold text-slate-800 dark:text-white group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors">${m.name}</p>
                    ${m.distance ? `<span class="text-[9px] font-bold text-slate-500 whitespace-nowrap">${formatDistance(m.distance)}</span>` : ''}
                  </div>
                  <p class="truncate text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">${m.address}</p>
                </div>
              </button>
            `;
          });
          suggestionsHtml += `</div></div>`;
        }

        suggestionsHtml += '</div>';

        if (suggestionsEl) {
          suggestionsEl.innerHTML = suggestionsHtml;
          suggestionsEl.classList.remove('hidden');

          const items = suggestionsEl.querySelectorAll<HTMLButtonElement>(
            'button.suggestion-item'
          );
          items.forEach((item) => {
            item.addEventListener('click', () => {
              const placeId = item.getAttribute('data-place-id');
              const placeType = item.getAttribute('data-place-type');

              if (placeType === 'local') {
                const found = localMatches.find((m) => m.id === placeId);
                if (found) selectSearchedPlace(found);
              } else {
                const found =
                  mapboxMatches.find((m) => m.id === placeId) ||
                  localMatches.find((m) => m.id === placeId);
                if (found) selectSearchedPlace(found);
              }
            });
          });
        }
        activeSuggestionIndex = -1;
      }, 300);
    });
  }

  const documentClickHandlerForLifecycle = (e: MouseEvent) => {
    const target = e.target as Node;
    if (
      sInput &&
      !sInput.contains(target) &&
      suggestionsEl &&
      !suggestionsEl.contains(target)
    ) {
      closeSuggestions();
    }
  };
  documentClickHandler = documentClickHandlerForLifecycle;
  document.addEventListener('click', documentClickHandlerForLifecycle);

  const aiRouteHandlerForLifecycle = (e: Event) => {
    if (activeMapLifecycle !== lifecycle) return;
    const customEvent = e as CustomEvent<{ route: string[] }>;
    const routeMonumentIds = customEvent.detail.route;
    if (!routeMonumentIds || routeMonumentIds.length === 0) return;

    const coordinates: [number, number][] = [];
    if (userLng !== null && userLat !== null) {
      coordinates.push([userLng, userLat]);
    }
    routeMonumentIds.forEach((id) => {
      const monument = MONUMENTS.find((m) => m.id === id);
      if (monument) {
        coordinates.push([monument.lng, monument.lat]);
      }
    });

    if (coordinates.length < 2) {
      alert('No coordinates found to draw the route.');
      return;
    }

    routeRequestController?.abort();
    const controller = new AbortController();
    routeRequestController = controller;

    const firstMonument = MONUMENTS.find((m) => m.id === routeMonumentIds[0]);
    const routePlace: Place = {
      id: 'ai-route',
      name: 'Ruta Recomendada por IA',
      category: 'route',
      address: routeMonumentIds
        .map((id) => MONUMENTS.find((m) => m.id === id)?.name || id)
        .join(' → '),
      lat: firstMonument?.lat || coordinates[0]?.[1] || 0,
      lng: firstMonument?.lng || coordinates[0]?.[0] || 0,
    };

    selectPlace(routePlace);
    void drawMultiStopRoute(coordinates, controller.signal);
  };
  aiRouteHandler = aiRouteHandlerForLifecycle;
  window.addEventListener('ai-route-generated', aiRouteHandlerForLifecycle);

  $('btn-style-toggle')?.addEventListener('click', () => {
    cancelDetailed3DUpgrade();
    currentStyleIdx = (currentStyleIdx + 1) % STYLES.length;
    detailed3DEnabled = currentStyleIdx === 0;
    map.setStyle(STYLES[currentStyleIdx].id);
  });

  $('btn-locate')?.addEventListener('click', () => {
    if (userMarker && userLng && userLat) {
      map.flyTo({
        center: [userLng, userLat],
        zoom: 16,
        pitch: 45,
        duration: 1000,
      });
    } else {
      requestLocationPermission();
    }
  });

  $('geo-status')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (userMarker && userLng && userLat) {
      map.flyTo({
        center: [userLng, userLat],
        zoom: 16,
        pitch: 45,
        duration: 1000,
      });
    } else {
      requestLocationPermission();
    }
  });

  // Start geolocation watch immediately without welcome modal
  startWatching();

  // Check for placeId in URL parameters to auto-select a place
  const params = new URLSearchParams(window.location.search);
  const urlPlaceId = params.get('placeId');
  if (urlPlaceId) {
    const monument = MONUMENTS.find((m) => m.id === urlPlaceId);
    if (monument) {
      const locale = detectLocale();
      const distKm =
        userLat && userLng
          ? haversine(userLat, userLng, monument.lat, monument.lng)
          : undefined;
      const place: Place = {
        id: monument.id,
        name: pickLocalized(monument, 'name', locale),
        category: normalizeCategory(monument.type || 'monument'),
        address: pickLocalized(monument, 'desc', locale),
        lat: monument.lat,
        lng: monument.lng,
        distance: distKm,
      };

      if (map.loaded()) {
        selectSearchedPlace(place);
      } else {
        map.once('load', () => selectSearchedPlace(place));
      }
    }
  }

  setTimeout(() => {
    if (activeMapLifecycle === lifecycle && map) map.resize();
  }, 200);
}

function cleanUpMap() {
  activeMapLifecycle = ++mapLifecycleSequence;
  cancelDetailed3DUpgrade();
  detailed3DEnabled = false;
  if (searchDebounce) {
    clearTimeout(searchDebounce);
    searchDebounce = null;
  }
  searchAbortController?.abort();
  searchAbortController = null;
  nearbyRequestController?.abort();
  nearbyRequestController = null;
  routeRequestController?.abort();
  routeRequestController = null;
  travelVisualization?.destroy();
  travelVisualization = null;
  if (refreshDebounce) {
    clearTimeout(refreshDebounce);
    refreshDebounce = null;
  }
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  if (documentClickHandler) {
    document.removeEventListener('click', documentClickHandler);
    documentClickHandler = null;
  }
  if (aiRouteHandler) {
    window.removeEventListener('ai-route-generated', aiRouteHandler);
    aiRouteHandler = null;
  }
  window.removeEventListener('resize', updateSheetUI);
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  hideZoneCard();
  for (const marker of zoneMarkers) marker.remove();
  zoneMarkers.length = 0;
  // Reset the zone render cache so the next mount rebuilds from scratch.
  zoneRenderCacheKey = null;
  clearPlaceMarkers();
  clusterIndex = null;
  clusterDataVersion = 0;
  if (map) {
    try {
      map.remove();
    } catch {}
  }
  userMarker = null;
  selectedPlace = null;
  isCollapsed = true;
  nearbyPlaces = [];
  lastRenderedCacheKey = null;
  activePinFilter = 'all';
  firstLocationFetched = false;
}

// ---------------------------------------------------------------------------
// Bind Astro view transition lifecycles
// ---------------------------------------------------------------------------
export function mountMap(): void {
  bindFilterChips();
  bindAudioPlayerControls();
  if ($('map')) initMap();
}

document.addEventListener('astro:before-swap', () => {
  cleanUpMap();
});

window.addEventListener('pagehide', (event) => {
  if (!event.persisted) cleanUpMap();
});

window.addEventListener('pageshow', (event) => {
  const mapWasRemoved =
    !map || Boolean((map as unknown as { _removed?: boolean })._removed);
  if (event.persisted && $('map') && mapWasRemoved) {
    initMap();
  }
});

window.addEventListener('beforeunload', cleanUpMap, { once: true });

// ---------------------------------------------------------------------------
// Audio Player & Badge Unlock Integration
// ---------------------------------------------------------------------------
const MONUMENT_BADGE_MAP: Record<string, number> = {
  'bellas-artes': 1,
  'catedral': 2,
  'hotel-virreyes': 3,
  'templo-mayor': 4,
};

const BADGE_NAMES: Record<number, string> = {
  1: 'Explorador Romano (Palacio de Bellas Artes)',
  2: 'Alma Gótica (Catedral Metropolitana)',
  3: 'Legado Virreinal (Hotel Virreyes)',
  4: 'Cazador de Templos (Templo Mayor)',
};

const BADGE_IMAGES: Record<number, string> = {
  1: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=150&h=150&q=80',
  2: 'https://images.unsplash.com/photo-1543872084-c7bd3822856f?auto=format&fit=crop&w=150&h=150&q=80',
  3: 'https://coming-aqua-flyingfish.myfilebase.com/ipfs/QmSb45pdEwGTuJFivhHuaRwZZFX83nrx4Gki1o5cCXqDo1',
  4: 'https://images.unsplash.com/photo-1508849789987-4e5333c12b78?auto=format&fit=crop&w=150&h=150&q=80',
};

const audioEl = new Audio();
audioEl.preload = 'none';
let audioTimer: ReturnType<typeof setInterval> | null = null;
let audioSec = 0;
let audioDur = 0;
let isAudioPlaying = false;

function parseAudioDur(durationStr: string): number {
  const parts = durationStr.split(':').map((p) => parseInt(p, 10));
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 120;
}

function fmtAudioTime(seconds: number): string {
  const total = Math.floor(seconds);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function showBadgeNotification(badgeId: number) {
  const name = BADGE_NAMES[badgeId] || 'Nueva Insignia';
  const img = BADGE_IMAGES[badgeId] || '';

  const toast = document.createElement('div');
  toast.className =
    'fixed top-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 rounded-2xl border border-white/20 bg-white/95 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.15)] backdrop-blur-md transition-all duration-500 scale-90 opacity-0 dark:border-slate-800/50 dark:bg-slate-900/95 text-slate-800 dark:text-white';
  toast.innerHTML = `
    <div class="h-10 w-10 overflow-hidden rounded-full border border-slate-200/80 dark:border-slate-800">
      <img src="${img}" alt="${name}" class="h-full w-full object-cover" />
    </div>
    <div class="text-left">
      <p class="text-[9px] font-bold uppercase tracking-wider text-accent-500 dark:text-accent-400">¡Logro Desbloqueado!</p>
      <p class="text-[12px] font-semibold">${name}</p>
    </div>
  `;

  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('scale-90', 'opacity-0');
    toast.classList.add('scale-100', 'opacity-100');
  });

  setTimeout(() => {
    toast.classList.remove('scale-100', 'opacity-100');
    toast.classList.add('scale-90', 'opacity-0');
    setTimeout(() => {
      toast.remove();
    }, 500);
  }, 4000);
}

function updateAudioUI() {
  const m = selectedPlace
    ? MONUMENTS.find(
        (x) =>
          x.id === selectedPlace?.id ||
          x.name.toLowerCase() === selectedPlace?.name.toLowerCase()
      )
    : null;
  const progressFill = document.getElementById('progress-bar-fill');
  const timeLabel = document.getElementById('player-time');
  const maxDurStr = m?.audioDuration || '1:50';
  if (progressFill && audioDur > 0) {
    progressFill.style.width = `${(audioSec / audioDur) * 100}%`;
  }
  if (timeLabel) {
    timeLabel.textContent = `${fmtAudioTime(audioSec)} / ${maxDurStr}`;
  }
}

function startAudio() {
  if (!selectedPlace) return;
  const m = MONUMENTS.find(
    (x) =>
      x.id === selectedPlace?.id ||
      x.name.toLowerCase() === selectedPlace?.name.toLowerCase()
  );
  if (!m) return;

  const btnPlay = document.getElementById('btn-play-audio');
  const playerUI = document.getElementById('audio-player');
  const toggleIcon = document.getElementById('player-toggle-icon');

  audioDur = parseAudioDur(m.audioDuration || '1:50');
  btnPlay?.classList.add('hidden');
  playerUI?.classList.remove('hidden');
  isAudioPlaying = true;
  if (toggleIcon) toggleIcon.textContent = 'pause';

  const audioUrl = m.audioUrl || (m as any).audio_url;
  if (audioUrl) {
    audioEl.src = audioUrl;
    audioEl.currentTime = 0;
    const playPromise = audioEl.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        console.warn('[startAudio] audio.play() failed:', err);
      });
    }
  } else {
    if (audioTimer) clearInterval(audioTimer);
    audioTimer = setInterval(() => {
      if (audioSec < audioDur) {
        audioSec++;
        updateAudioUI();
      } else {
        stopAudio();
      }
    }, 1000);
  }

  const badgeId = MONUMENT_BADGE_MAP[m.id];
  if (badgeId) {
    fetch('/api/unlock-badge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        badgeId,
        monumentName: BADGE_NAMES[badgeId] || m.name,
        monumentImage: BADGE_IMAGES[badgeId] || m.image,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success) {
          showBadgeNotification(badgeId);
        }
      })
      .catch(() => {});
  }
}

function toggleAudio() {
  const toggleIcon = document.getElementById('player-toggle-icon');
  if (isAudioPlaying) {
    if (audioTimer) clearInterval(audioTimer);
    audioTimer = null;
    isAudioPlaying = false;
    if (toggleIcon) toggleIcon.textContent = 'play_arrow';
    audioEl.pause();
  } else {
    isAudioPlaying = true;
    if (toggleIcon) toggleIcon.textContent = 'pause';
    const m = selectedPlace
      ? MONUMENTS.find(
          (x) =>
            x.id === selectedPlace?.id ||
            x.name.toLowerCase() === selectedPlace?.name.toLowerCase()
        )
      : null;
    if (!m) return;
    audioDur = parseAudioDur(m.audioDuration || '1:50');
    const audioUrl = m.audioUrl || (m as any).audio_url;

    if (audioUrl && audioEl.src) {
      const playPromise = audioEl.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
          console.warn('[toggleAudio] audio.play() failed:', err);
        });
      }
    } else {
      audioTimer = setInterval(() => {
        if (audioSec < audioDur) {
          audioSec++;
          updateAudioUI();
        } else {
          stopAudio();
        }
      }, 1000);
    }
  }
}

function stopAudio() {
  if (audioTimer) clearInterval(audioTimer);
  audioTimer = null;
  audioSec = 0;
  isAudioPlaying = false;
  const progressFill = document.getElementById('progress-bar-fill');
  const btnPlay = document.getElementById('btn-play-audio');
  const playerUI = document.getElementById('audio-player');

  if (progressFill) progressFill.style.width = '0%';
  btnPlay?.classList.remove('hidden');
  playerUI?.classList.add('hidden');
  audioEl.pause();
}

audioEl.addEventListener('timeupdate', () => {
  if (!isAudioPlaying) return;
  const m = selectedPlace
    ? MONUMENTS.find(
        (x) =>
          x.id === selectedPlace?.id ||
          x.name.toLowerCase() === selectedPlace?.name.toLowerCase()
      )
    : null;
  if (!m) return;
  const realDur = audioEl.duration;
  if (isFinite(realDur) && realDur > 0) {
    audioDur = realDur;
  }
  audioSec = audioEl.currentTime;
  updateAudioUI();
});

audioEl.addEventListener('ended', () => {
  stopAudio();
});

function bindAudioPlayerControls(): void {
  const btnPlay = document.getElementById('btn-play-audio');
  const toggleBtn = document.getElementById('btn-player-toggle');
  const stopBtn = document.getElementById('btn-player-stop');
  const progressContainer = document.getElementById('progress-bar-container');

  btnPlay?.addEventListener('click', startAudio);
  toggleBtn?.addEventListener('click', toggleAudio);
  stopBtn?.addEventListener('click', stopAudio);

  progressContainer?.addEventListener('click', (e) => {
    const rect = progressContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    if (audioDur > 0) {
      audioSec = pct * audioDur;
      if (audioEl.src && isFinite(audioEl.duration) && audioEl.duration > 0) {
        audioEl.currentTime = audioSec;
      }
      updateAudioUI();
    }
  });
}

window.addEventListener('ai-play-audio', (e: Event) => {
  const customEv = e as CustomEvent<{ monumentId?: string }>;
  const monId = customEv.detail?.monumentId;
  if (monId) {
    const mon = MONUMENTS.find((m) => m.id === monId);
    if (mon) {
      selectPlace({
        id: mon.id,
        name: mon.name,
        category: mon.category,
        address: mon.city,
        lat: mon.lat,
        lng: mon.lng,
        emoji: mon.emoji,
      });
      startAudio();
    }
  }
});
