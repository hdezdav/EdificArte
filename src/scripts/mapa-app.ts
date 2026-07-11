import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type {
  LatLngTuple,
  Marker as LMarker,
  Circle as LCircle,
} from 'leaflet';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type MonumentType = 'museo' | 'templo' | 'arqueologia' | 'rascacielos' | 'sitio-remoto';
type TileKey = 'osm' | 'light' | 'dark' | 'sat';

interface Monument {
  id: string;
  name: string;
  category: string;
  dist: string;
  lat: number;
  lng: number;
  emoji: string;
  desc: string;
  audioDuration: string;
  type: MonumentType;
  image: string;
}

interface VisitRecord {
  visited: boolean;
  rating: number;
  review: string;
  date: string;
}

// ---------------------------------------------------------------------------
// Datos (mock — Slice 1)
// ---------------------------------------------------------------------------

import { MONUMENTS } from '../data/monuments';

// En el mapa NO mostramos monumentos remotos (sitios arqueológicos fuera de CDMX
// con experiencia VR). Solo aparecen en Explorar. Mantenemos MONUMENTS completo
// para que `.find()` siga resolviendo por id al abrir detail / reproducir audio / trazar ruta.
const MAPPABLE_MONUMENTS: typeof MONUMENTS = MONUMENTS.filter(
  (m) => m.type !== 'sitio-remoto'
);

const CDMX: LatLngTuple = [19.4326, -99.1332];

const TILES: Record<TileKey, string> = {
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  sat: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};
const TILE_ORDER: TileKey[] = ['osm', 'light', 'dark', 'sat'];

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

let tileIdx = 0;
let selectedId: string | null = null;
let selectedRating = 5;
let isCollapsed = true;
let timer: ReturnType<typeof setInterval> | null = null;
let sec = 0;
let dur = 0;
let playing = false;
let userMarker: LMarker | null = null;
let userCircle: LCircle | null = null;
let watchId: number | null = null;
let routeAbortController: AbortController | null = null;

// ---------------------------------------------------------------------------
// Storage helpers — Safari/Firefox ITP protection (in-memory fallback)
// ---------------------------------------------------------------------------

const memoryStore: Map<string, string> = new Map();

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryStore.has(key) ? (memoryStore.get(key) as string) : null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memoryStore.set(key, value);
  }
}

// ---------------------------------------------------------------------------
// Helpers de UI
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const pinIcon = (emoji: string, selected = false): L.DivIcon =>
  L.divIcon({
    html: `<div class="monument-pin ${selected ? 'selected' : ''}"><span style="font-size:20px;line-height:1">${emoji}</span></div>`,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -22],
  });

const parseDur = (s: string): number => {
  const p = s.split(':');
  return Number(p[0]) * 60 + Number(p[1]);
};

const fmt = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------------

const map = L.map('map', {
  center: CDMX,
  zoom: 17,
  zoomControl: false,
  attributionControl: false,
});
let tileLayer = L.tileLayer(TILES[TILE_ORDER[tileIdx]], {
  subdomains: 'abcd',
  maxZoom: 19,
}).addTo(map);

const markers: { id: string; emoji: string; inst: LMarker }[] = [];
let activeRouteLine: L.Polyline | null = null;

function addMarkers(list: Monument[]) {
  markers.forEach((m) => map.removeLayer(m.inst));
  markers.length = 0;
  list.forEach((m) => {
    const inst = L.marker([m.lat, m.lng], { icon: pinIcon(m.emoji) })
      .addTo(map)
      .on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectMonument(m.id);
      });
    markers.push({ id: m.id, emoji: m.emoji, inst });
  });
}

addMarkers(MAPPABLE_MONUMENTS);

map.on('click', () => deselect());

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const viewList = $('view-list');
const viewDetail = $('view-detail');
const listContainer = $('monuments-list-container');
const searchInput = $<HTMLInputElement>('search-input');

// ---------------------------------------------------------------------------
// Bottom Sheet
// ---------------------------------------------------------------------------

const bottomSheet = $('bottom-sheet');
const sheetHeader = $('sheet-header');
const sheetChevron = $('sheet-chevron');
const sheetBody = $('sheet-body');
const floatingControls = $('map-floating-controls');

function updateSheetUI() {
  if (!bottomSheet || !sheetChevron || !sheetBody) return;

  if (isCollapsed) {
    sheetBody.style.maxHeight = '0px';
    sheetBody.style.opacity = '0';
    sheetBody.style.pointerEvents = 'none';
    sheetChevron.style.transform = 'rotate(0deg)';
    if (floatingControls) {
      floatingControls.style.bottom = 'calc(5.5rem + env(safe-area-inset-bottom, 0px))';
    }
  } else {
    sheetBody.style.maxHeight = '360px';
    sheetBody.style.opacity = '1';
    sheetBody.style.pointerEvents = 'auto';
    sheetChevron.style.transform = 'rotate(180deg)';
    if (floatingControls) {
      floatingControls.style.bottom = 'calc(28.5rem + env(safe-area-inset-bottom, 0px))';
    }
  }
}

updateSheetUI();

sheetHeader?.addEventListener('click', () => {
  isCollapsed = !isCollapsed;
  updateSheetUI();
});

bottomSheet?.addEventListener('click', (e) => e.stopPropagation());

// ---------------------------------------------------------------------------
// List render
// ---------------------------------------------------------------------------

function renderList(list: Monument[]) {
  if (!listContainer) return;
  listContainer.innerHTML = '';
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'py-6 text-center text-[12px] text-[#a0a0a0]';
    empty.textContent = 'No se encontraron monumentos.';
    listContainer.appendChild(empty);
    return;
  }
  list.forEach((m) => {
    const el = document.createElement('div');
    el.className =
      'flex items-center gap-3 rounded-2xl border border-black/[0.04] bg-white/60 p-2.5 backdrop-blur-md transition-all hover:bg-white/90 cursor-pointer active:scale-[0.98]';

    const emojiWrap = document.createElement('span');
    emojiWrap.className =
      'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#f5f3ff] text-xl';
    emojiWrap.textContent = m.emoji;
    el.appendChild(emojiWrap);

    const textWrap = document.createElement('div');
    textWrap.className = 'min-w-0 flex-1';

    const nameEl = document.createElement('p');
    nameEl.className = 'truncate text-[13px] font-bold text-[#1b1c1c]';
    nameEl.textContent = m.name;
    textWrap.appendChild(nameEl);

    const catEl = document.createElement('p');
    catEl.className = 'text-[11px] font-medium text-[#5c5c5c]';
    catEl.textContent = `${m.category} · `;

    const distEl = document.createElement('span');
    distEl.className = 'font-semibold';
    distEl.textContent = m.dist;
    catEl.appendChild(distEl);
    textWrap.appendChild(catEl);

    el.appendChild(textWrap);

    const playWrap = document.createElement('span');
    playWrap.className =
      'flex h-7 w-7 items-center justify-center rounded-full bg-[#f5f3ff] text-[#3f043a]';

    const playIcon = document.createElement('span');
    playIcon.className = 'material-symbols-outlined text-[16px]';
    playIcon.style.fontVariationSettings = "'FILL' 1";
    playIcon.textContent = 'play_arrow';
    playWrap.appendChild(playIcon);

    el.appendChild(playWrap);

    el.addEventListener('click', () => selectMonument(m.id));
    listContainer.appendChild(el);
  });
}

renderList(MAPPABLE_MONUMENTS);

// ---------------------------------------------------------------------------
// Selection & Visit Section
// ---------------------------------------------------------------------------

function resetStarsUI() {
  document.querySelectorAll<HTMLElement>('#rating-stars span').forEach((s) => {
    s.style.fontVariationSettings = "'FILL' 1";
  });
}

function loadVisits(): Record<string, VisitRecord> {
  try {
    return JSON.parse(safeGet('edificarte_visited') || '{}');
  } catch {
    return {};
  }
}

function updateVisitSection(m: Monument) {
  const visitFarWarning = $('visit-far-warning');
  const visitNearForm = $('visit-near-form');
  const visitSavedDisplay = $('visit-saved-display');
  const visitStatusTag = $('visit-status-tag');
  const visitDistanceText = $('visit-distance-text');
  const markVisitedBtn = $('btn-mark-visited');
  const reviewFields = $('review-fields');

  if (
    !visitFarWarning ||
    !visitNearForm ||
    !visitSavedDisplay ||
    !visitStatusTag
  )
    return;

  const reviewInput = $<HTMLTextAreaElement>('review-input');
  if (reviewInput) reviewInput.value = '';
  selectedRating = 5;
  resetStarsUI();

  reviewFields?.classList.add('hidden');
  markVisitedBtn?.classList.remove('hidden');

  const saved = loadVisits()[m.id];

  if (saved) {
    visitStatusTag.textContent = 'Visitado';
    visitStatusTag.className =
      'text-[10px] font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full';
    visitFarWarning.classList.add('hidden');
    visitNearForm.classList.add('hidden');
    visitSavedDisplay.classList.remove('hidden');

    const starsDisplay = $('saved-stars-display');
    if (starsDisplay) {
      starsDisplay.innerHTML = '';
      for (let i = 1; i <= 5; i++) {
        const star = document.createElement('span');
        star.className = 'material-symbols-outlined text-[16px]';
        star.textContent = i <= saved.rating ? 'star' : 'star_outline';
        starsDisplay.appendChild(star);
      }
    }
    const savedReviewText = $('saved-review-text');
    if (savedReviewText) {
      savedReviewText.textContent = saved.review
        ? `"${saved.review}"`
        : 'Sin reseña escrita.';
    }
    return;
  }

  visitSavedDisplay.classList.add('hidden');

  let distanceMeters: number | null = null;
  if (userMarker) {
    distanceMeters = userMarker.getLatLng().distanceTo(L.latLng(m.lat, m.lng));
  }

  if (distanceMeters !== null && distanceMeters <= 200) {
    visitStatusTag.textContent = 'Cerca';
    visitStatusTag.className =
      'text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full';
    visitFarWarning.classList.add('hidden');
    visitNearForm.classList.remove('hidden');
  } else {
    visitStatusTag.textContent = 'Lejos';
    visitStatusTag.className =
      'text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full';
    visitNearForm.classList.add('hidden');
    visitFarWarning.classList.remove('hidden');
    if (visitDistanceText) {
      visitDistanceText.textContent =
        distanceMeters !== null
          ? `(Estás a ${(distanceMeters / 1000).toFixed(2)} km).`
          : '(Ubicación GPS no disponible).';
    }
  }
}

function selectMonument(id: string) {
  selectedId = id;
  const m = MONUMENTS.find((x) => x.id === id);
  if (!m) return;

  map.setView([m.lat, m.lng], 18, { animate: true });

  const detailImage = $<HTMLImageElement>('detail-image');
  if (detailImage) {
    detailImage.src = m.image || '';
    detailImage.alt = m.name;
  }

  $('detail-emoji')!.textContent = m.emoji;
  $('detail-name')!.textContent = m.name;
  $('detail-category')!.innerHTML =
    `${m.category} · <span id="detail-dist" class="font-semibold text-[#1b1c1c]">${m.dist}</span>`;
  $('detail-desc')!.textContent = m.desc;
  $('detail-duration')!.textContent = m.audioDuration;
  $('player-time')!.textContent = `0:00 / ${m.audioDuration}`;

  stopAudio();
  markers.forEach((x) => x.inst.setIcon(pinIcon(x.emoji, x.id === id)));
  updateVisitSection(m);

  viewList?.classList.add('hidden');
  viewDetail?.classList.remove('hidden');

  isCollapsed = false;
  updateSheetUI();
}

function deselect() {
  selectedId = null;
  stopAudio();
  markers.forEach((x) => x.inst.setIcon(pinIcon(x.emoji, false)));
  viewDetail?.classList.add('hidden');
  viewList?.classList.remove('hidden');
  isCollapsed = true;
  updateSheetUI();
}


$('btn-close-detail')?.addEventListener('click', deselect);

// ---------------------------------------------------------------------------
// Visit & Review handlers
// ---------------------------------------------------------------------------

$('btn-mark-visited')?.addEventListener('click', () => {
  $('btn-mark-visited')?.classList.add('hidden');
  $('review-fields')?.classList.remove('hidden');
});

document.querySelectorAll<HTMLElement>('#rating-stars span').forEach((star) => {
  star.addEventListener('click', () => {
    selectedRating = parseInt(star.getAttribute('data-val') || '5', 10);
    document
      .querySelectorAll<HTMLElement>('#rating-stars span')
      .forEach((s, idx) => {
        s.style.fontVariationSettings =
          idx < selectedRating ? "'FILL' 1" : "'FILL' 0";
      });
  });
});

$('btn-save-review')?.addEventListener('click', () => {
  const reviewInput = $<HTMLTextAreaElement>('review-input');
  const reviewText = reviewInput ? reviewInput.value.trim() : '';

  if (!selectedId) return;
  const saved = loadVisits();
  saved[selectedId] = {
    visited: true,
    rating: selectedRating,
    review: reviewText,
    date: new Date().toISOString(),
  };
  safeSet('edificarte_visited', JSON.stringify(saved));

  const m = MONUMENTS.find((x) => x.id === selectedId);
  if (m) updateVisitSection(m);
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function filterByQuery(list: Monument[], q: string): Monument[] {
  return list.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      m.desc.toLowerCase().includes(q)
  );
}

let searchDebounce: ReturnType<typeof setTimeout> | null = null;
searchInput?.addEventListener('input', (e) => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    const q = (e.target as HTMLInputElement).value.toLowerCase().trim();
    const f = filterByQuery(MAPPABLE_MONUMENTS, q);
    addMarkers(f);
    renderList(f);
    if (selectedId && !f.some((m) => m.id === selectedId)) deselect();
  }, 200);
});

// ---------------------------------------------------------------------------
// Filter dropdown
// ---------------------------------------------------------------------------

const btnSearchFilters = $('btn-search-filters');
const searchFiltersDropdown = $('search-filters-dropdown');
const btnResetFilters = $('btn-reset-filters');
const btnApplyFilters = $('btn-apply-filters');

if (btnSearchFilters && searchFiltersDropdown) {
  btnSearchFilters.addEventListener('click', (e) => {
    e.stopPropagation();
    searchFiltersDropdown.classList.toggle('hidden');
  });

  searchFiltersDropdown.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('click', () =>
    searchFiltersDropdown.classList.add('hidden')
  );

  btnResetFilters?.addEventListener('click', () => {
    searchFiltersDropdown
      .querySelectorAll<HTMLInputElement>('input[type="radio"]')
      .forEach((rad) => {
        rad.checked = rad.value === 'distance' || rad.value === 'all';
      });
    searchFiltersDropdown
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((c) => (c.checked = false));

    const q = searchInput?.value.toLowerCase().trim() ?? '';
    const f = filterByQuery(MAPPABLE_MONUMENTS, q);
    addMarkers(f);
    renderList(f);
    searchFiltersDropdown.classList.add('hidden');
  });

  btnApplyFilters?.addEventListener('click', () => {
    const sortBy = searchFiltersDropdown.querySelector<HTMLInputElement>(
      'input[name="sort-by"]:checked'
    )?.value;
    const visitedFilter = searchFiltersDropdown.querySelector<HTMLInputElement>(
      'input[name="filter-visited"]:checked'
    )?.value;
    const onlyAudio = $<HTMLInputElement>('filter-audioguide')?.checked;
    const onlyFeatured = $<HTMLInputElement>('filter-featured')?.checked;

    const q = searchInput?.value.toLowerCase().trim() ?? '';
    let f = filterByQuery(MAPPABLE_MONUMENTS, q);

    const saved = loadVisits();
    if (visitedFilter === 'visited') {
      f = f.filter((m) => saved[m.id]?.visited);
    } else if (visitedFilter === 'unvisited') {
      f = f.filter((m) => !saved[m.id]?.visited);
    }
    if (onlyAudio) f = f.filter((m) => !!m.audioDuration);
    if (onlyFeatured)
      f = f.filter((m) =>
        ['bellas-artes', 'angel', 'chapultepec'].includes(m.id)
      );

    if (sortBy === 'name') {
      f.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'distance') {
      f.sort((a, b) => parseFloat(a.dist) - parseFloat(b.dist));
    }

    addMarkers(f);
    renderList(f);
    searchFiltersDropdown.classList.add('hidden');
  });
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

document.querySelectorAll<HTMLElement>('.filter-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document
      .querySelectorAll('.filter-chip')
      .forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    const filter = chip.getAttribute('data-filter');
    const f =
      !filter || filter === 'all'
        ? MAPPABLE_MONUMENTS
        : MAPPABLE_MONUMENTS.filter((m) => m.type === filter);
    addMarkers(f);
    renderList(f);
    if (selectedId && !f.some((m) => m.id === selectedId)) deselect();
  });
});

// ---------------------------------------------------------------------------
// Tile toggle
// ---------------------------------------------------------------------------

$('btn-style-toggle')?.addEventListener('click', () => {
  map.removeLayer(tileLayer);
  tileIdx = (tileIdx + 1) % TILE_ORDER.length;
  tileLayer = L.tileLayer(TILES[TILE_ORDER[tileIdx]], {
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);
});

// ---------------------------------------------------------------------------
// Audio (simulado — Slice 1)
// ---------------------------------------------------------------------------

const btnPlay = $('btn-play-audio');
const playerUI = $('audio-player');
const progressFill = $('progress-bar-fill');
const progressContainer = $('progress-bar-container');
const timeLabel = $('player-time');
const toggleBtn = $('btn-player-toggle');
const toggleIcon = $('player-toggle-icon');

function updateAudioUI() {
  const m = MONUMENTS.find((x) => x.id === selectedId);
  if (!m || !progressFill || !timeLabel) return;
  progressFill.style.width = `${(sec / dur) * 100}%`;
  timeLabel.textContent = `${fmt(sec)} / ${m.audioDuration}`;
}

const MONUMENT_BADGE_MAP: Record<string, number> = {
  'bellas-artes': 1,
  'catedral': 2,
  'torre-latino': 3,
  'templo-mayor': 4
};

function showBadgeNotification(badgeId: number) {
  const badgeNames: Record<number, string> = {
    1: 'Explorador Romano (Palacio de Bellas Artes)',
    2: 'Alma Gótica (Catedral Metropolitana)',
    3: 'Guardián del Tiempo (Torre Latinoamericana)',
    4: 'Cazador de Templos (Templo Mayor)'
  };
  const badgeImages: Record<number, string> = {
    1: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=150&h=150&q=80',
    2: 'https://images.unsplash.com/photo-1543872084-c7bd3822856f?auto=format&fit=crop&w=150&h=150&q=80',
    3: 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=150&h=150&q=80',
    4: 'https://images.unsplash.com/photo-1508849789987-4e5333c12b78?auto=format&fit=crop&w=150&h=150&q=80'
  };

  const name = badgeNames[badgeId] || 'Nueva Insignia';
  const img = badgeImages[badgeId];

  // Crear elemento de notificación flotante premium
  const toast = document.createElement('div');
  toast.className = 'fixed top-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 rounded-2xl border border-white/20 bg-white/95 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.15)] backdrop-blur-md transition-all duration-500 scale-90 opacity-0 dark:border-slate-800/50 dark:bg-slate-900/95 text-slate-800 dark:text-white';
  toast.innerHTML = `
    <div class="h-10 w-10 overflow-hidden rounded-full border border-slate-200/80 dark:border-slate-800">
      <img src="${img}" alt="${name}" class="h-full w-full object-cover" />
    </div>
    <div class="text-left">
      <p class="text-[9px] font-bold uppercase tracking-wider text-brand-500 dark:text-brand-400">¡Logro Desbloqueado!</p>
      <p class="text-[12px] font-semibold">${name}</p>
    </div>
  `;

  document.body.appendChild(toast);

  // Animar entrada
  requestAnimationFrame(() => {
    toast.classList.remove('scale-90', 'opacity-0');
    toast.classList.add('scale-100', 'opacity-100');
  });

  // Animar salida y remover
  setTimeout(() => {
    toast.classList.remove('scale-100', 'opacity-100');
    toast.classList.add('scale-90', 'opacity-0');
    setTimeout(() => {
      toast.remove();
    }, 500);
  }, 4000);
}

function startAudio() {
  const m = MONUMENTS.find((x) => x.id === selectedId);
  if (!m) return;
  dur = parseDur(m.audioDuration);
  btnPlay?.classList.add('hidden');
  playerUI?.classList.remove('hidden');
  playing = true;
  if (toggleIcon) toggleIcon.textContent = 'pause';

  // Desbloquear logro al reproducir audioguía si está logueado
  const badgeId = MONUMENT_BADGE_MAP[m.id];
  if (badgeId) {
    fetch('/api/unlock-badge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ badgeId })
    })
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Not logged in or error');
      })
      .then((data: any) => {
        if (data.success) {
          showBadgeNotification(badgeId);
          if (data.isGuest) {
            try {
              const guestBadges = JSON.parse(safeGet('edificarte_guest_badges') || '[]');
              if (!guestBadges.includes(badgeId)) {
                guestBadges.push(badgeId);
                safeSet('edificarte_guest_badges', JSON.stringify(guestBadges));

                // Sumar 100 puntos y +1 visita al invitado de forma local
                const guestPoints = Number(safeGet('edificarte_guest_points') || '0') + 100;
                const guestVisits = Number(safeGet('edificarte_guest_visits') || '0') + 1;
                safeSet('edificarte_guest_points', String(guestPoints));
                safeSet('edificarte_guest_visits', String(guestVisits));
              }
            } catch (e) {
              console.error('Error saving guest progress:', e);
            }
          }
        }
      })
      .catch(() => {
        // Ignoramos silenciosamente si no está autenticado ni como invitado
      });
  }

  timer = setInterval(() => {
    if (sec < dur) {
      sec++;
      updateAudioUI();
    } else {
      stopAudio();
    }
  }, 1000);
}

function toggleAudio() {
  if (playing) {
    if (timer) clearInterval(timer);
    playing = false;
    if (toggleIcon) toggleIcon.textContent = 'play_arrow';
  } else {
    playing = true;
    if (toggleIcon) toggleIcon.textContent = 'pause';
    const m = MONUMENTS.find((x) => x.id === selectedId);
    if (!m) return;
    dur = parseDur(m.audioDuration);
    timer = setInterval(() => {
      if (sec < dur) {
        sec++;
        updateAudioUI();
      } else {
        stopAudio();
      }
    }, 1000);
  }
}

function stopAudio() {
  if (timer) clearInterval(timer);
  timer = null;
  sec = 0;
  playing = false;
  if (progressFill) progressFill.style.width = '0%';
  btnPlay?.classList.remove('hidden');
  playerUI?.classList.add('hidden');
}

btnPlay?.addEventListener('click', startAudio);
toggleBtn?.addEventListener('click', toggleAudio);

$('btn-player-rw')?.addEventListener('click', () => {
  sec = Math.max(0, sec - 10);
  updateAudioUI();
});
$('btn-player-ff')?.addEventListener('click', () => {
  sec = Math.min(dur, sec + 10);
  updateAudioUI();
});
progressContainer?.addEventListener('click', (e) => {
  const r = progressContainer.getBoundingClientRect();
  sec = Math.round(((e.clientX - r.left) / r.width) * dur);
  updateAudioUI();
});

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------

const dot = $('geo-dot');
const geoText = $('geo-text');
const geoStatusEl = $('geo-status');

type GeoState = 'ok' | 'error' | 'loading';

const setGeo = (state: GeoState, msg: string) => {
  if (!dot || !geoText) return;
  dot.className = `h-2 w-2 rounded-full ${
    state === 'ok'
      ? 'bg-green-500'
      : state === 'error'
        ? 'bg-red-400'
        : 'bg-amber-400 animate-pulse'
  }`;
  geoText.textContent = msg;
};

let firstLocationFetched = false;

const onPos = (pos: GeolocationPosition) => {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  
  // Guardar ubicación en localStorage para que la use el chat de IA
  safeSet('edificarte_user_lat', lat.toString());
  safeSet('edificarte_user_lng', lng.toString());

  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
    userCircle?.setLatLng([lat, lng]).setRadius(accuracy);
  } else {
    userCircle = L.circle([lat, lng], {
      radius: accuracy,
      color: '#3f043a',
      fillColor: '#3f043a',
      fillOpacity: 0.06,
      weight: 1,
    }).addTo(map);
    userMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'user-dot',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    }).addTo(map);
  }
  setGeo('ok', 'Ubicación activa');

  // Centrar el mapa en la ubicación del usuario al recibirla por primera vez
  if (!firstLocationFetched) {
    map.setView([lat, lng], 17, { animate: true });
    firstLocationFetched = true;
  }

  if (selectedId) {
    const m = MONUMENTS.find((x) => x.id === selectedId);
    if (m) updateVisitSection(m);
  }
};

const onErr = (err: GeolocationPositionError) => {
  setGeo('error', err.code === 1 ? 'Permiso denegado' : 'Sin señal');
};

function startWatching() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  if ('geolocation' in navigator) {
    setGeo('loading', 'Localizando...');
    watchId = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000,
    });
  } else {
    setGeo('error', 'GPS no soportado');
  }
}

function showPermissionInstructions() {
  alert(
    'El acceso a la ubicación está desactivado.\n\n' +
      'Para activarlo:\n' +
      '1. Toca el ícono del candado o la configuración al lado de la dirección URL de esta página.\n' +
      '2. Cambia el permiso de "Ubicación" (Location) a "Permitir" (Allow).\n' +
      '3. Recarga la página.'
  );
}

function requestLocationPermission() {
  if (!('geolocation' in navigator)) {
    alert('Tu dispositivo o navegador no soporta geolocalización.');
    return;
  }

  if (navigator.permissions?.query) {
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        if (status.state === 'denied') showPermissionInstructions();
        else triggerLocationPrompt();
      })
      .catch(() => triggerLocationPrompt());
  } else {
    triggerLocationPrompt();
  }
}

function triggerLocationPrompt() {
  setGeo('loading', 'Localizando...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      onPos(pos);
      startWatching();
    },
    (err) => {
      onErr(err);
      if (err.code === 1) showPermissionInstructions();
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// Modal logic is handled by an inline script in mapa.astro (independent of Leaflet).
// mapa-app.ts only listens for custom events to start geolocation.

// If modals are already done (user has lang + welcome), start geolocation immediately
if (safeGet('edificarte_lang') && safeGet('edificarte_welcome_shown')) {
  startWatching();
}

// Listen for the inline modal script to signal modals are done
window.addEventListener('edificarte-request-gps', () => {
  triggerLocationPrompt();
});
window.addEventListener('edificarte-modals-done', () => {
  if (safeGet('edificarte_welcome_shown')) {
    startWatching();
  }
});

geoStatusEl?.addEventListener('click', (e) => {
  e.stopPropagation();
  requestLocationPermission();
});

$('btn-locate')?.addEventListener('click', () => {
  if (userMarker) map.setView(userMarker.getLatLng(), 18, { animate: true });
  else requestLocationPermission();
});

setTimeout(() => map.invalidateSize(), 200);

// ---------------------------------------------------------------------------
// Rutas de la IA (L.polyline)
// ---------------------------------------------------------------------------

async function drawRoute(ids: string[]) {
  if (activeRouteLine) {
    map.removeLayer(activeRouteLine);
    activeRouteLine = null;
  }

  if (!ids || ids.length === 0) return;

  const coords: [number, number][] = [];
  const found: Monument[] = [];

  // Agregar la ubicación actual del usuario como origen si está activa y es caminable (< 3km)
  let userLatLng: L.LatLng | null = null;
  if (userMarker) {
    const latLng = userMarker.getLatLng();
    const firstMon = MONUMENTS.find((x) => x.id === ids[0]);
    if (firstMon) {
      const monLatLng = L.latLng(firstMon.lat, firstMon.lng);
      const distMeters = latLng.distanceTo(monLatLng);
      if (distMeters < 3000) { // Si está a menos de 3 km
        userLatLng = latLng;
        coords.push([userLatLng.lat, userLatLng.lng]);
      }
    }
  }

  ids.forEach((id) => {
    const m = MONUMENTS.find((x) => x.id === id);
    if (m) {
      coords.push([m.lat, m.lng]);
      found.push(m);
    }
  });

  if (coords.length < 2) {
    if (found[0]) {
      selectMonument(found[0].id);
    }
    return;
  }

  // Intentar obtener la ruta peatonal real de OSRM (OpenStreetMap routing)
  try {
    let osrmCoords = '';
    if (userLatLng) {
      osrmCoords = `${userLatLng.lng},${userLatLng.lat};` + found.map(m => `${m.lng},${m.lat}`).join(';');
    } else {
      osrmCoords = found.map(m => `${m.lng},${m.lat}`).join(';');
    }

    // Cancelar fetch previo (si el usuario dispara varias rutas seguidas) y armar timeout 8s
    if (routeAbortController) routeAbortController.abort();
    const localAbort = new AbortController();
    routeAbortController = localAbort;
    const timeoutId = setTimeout(() => localAbort.abort(), 8000);

    let response: Response;
    try {
      response = await fetch(`https://router.project-osrm.org/route/v1/foot/${osrmCoords}?overview=full&geometries=geojson`, {
        signal: localAbort.signal,
      });
    } finally {
      clearTimeout(timeoutId);
      // Solo limpiar el controller global si sigue siendo el nuestro
      if (routeAbortController === localAbort) routeAbortController = null;
    }

    if (response.ok) {
      const data = await response.json();
      if (data.routes && data.routes[0]) {
        const routeCoords = data.routes[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]);

        activeRouteLine = L.polyline(routeCoords, {
          color: '#8b5cf6', // Púrpura premium
          weight: 5,
          opacity: 0.85,
          dashArray: '6, 8', // Estilo discontinuo
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);

        map.fitBounds(activeRouteLine.getBounds(), {
          padding: [60, 60],
          animate: true,
          duration: 1.2,
        });

        // Mostrar botón de limpiar ruta
        $('btn-clear-route')?.classList.remove('hidden');
        return;
      }
    }
  } catch (err) {
    // Si fue abortado (timeout o nueva búsqueda), NO actualizar el mapa: dejamos que el caller más reciente mande.
    if (err instanceof DOMException && err.name === 'AbortError') {
      return;
    }
    if ((err as any)?.name === 'AbortError') {
      return;
    }
    console.error('Error al obtener ruta peatonal real de OSRM, usando fallback rectilíneo:', err);
  }

  // Fallback: Trazar línea de ruta recta si OSRM falla
  activeRouteLine = L.polyline(coords, {
    color: '#8b5cf6', // Púrpura premium
    weight: 4,
    opacity: 0.8,
    dashArray: '6, 8', // Estilo discontinuo
    lineCap: 'round',
    lineJoin: 'round',
  }).addTo(map);

  // Encuadrar la vista del mapa en la ruta entera
  map.fitBounds(activeRouteLine.getBounds(), {
    padding: [60, 60],
    animate: true,
    duration: 1.2,
  });

  // Mostrar botón de limpiar ruta
  $('btn-clear-route')?.classList.remove('hidden');
}

// Handler para limpiar la ruta del mapa
$('btn-clear-route')?.addEventListener('click', () => {
  if (activeRouteLine) {
    map.removeLayer(activeRouteLine);
    activeRouteLine = null;
  }
  $('btn-clear-route')?.classList.add('hidden');
});

// Escuchar evento personalizado para trazar ruta
window.addEventListener('ai-route-generated', (e: any) => {
  const route = e.detail?.route;
  if (Array.isArray(route)) {
    drawRoute(route);
  }
});

// Escuchar evento personalizado para reproducir audioguía
window.addEventListener('ai-play-audio', (e: any) => {
  const monumentId = e.detail?.monumentId;
  if (monumentId) {
    selectMonument(monumentId);
    setTimeout(() => {
      startAudio();
    }, 400);
  }
});

// Comprobar parámetros de URL al cargar para dibujar la ruta e iniciar audio si se solicita
const urlParams = new URLSearchParams(window.location.search);
const urlRoute = urlParams.get('route');
const urlPlay = urlParams.get('play') === 'true';

if (urlRoute) {
  const ids = urlRoute.split(',');
  setTimeout(() => {
    drawRoute(ids);
    if (urlPlay && ids.length === 1) {
      setTimeout(() => {
        startAudio();
      }, 500);
    }
  }, 600);
}

