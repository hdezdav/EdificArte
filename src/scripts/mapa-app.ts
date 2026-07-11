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

type MonumentType = 'museo' | 'templo' | 'arqueologia' | 'rascacielos';
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

const MONUMENTS: Monument[] = [
  {
    id: 'bellas-artes',
    name: 'Palacio de Bellas Artes',
    category: 'Museo / Teatro',
    dist: '0.3 km',
    lat: 19.4352,
    lng: -99.1412,
    emoji: '🏛️',
    desc: 'Una de las casas de ópera más famosas del mundo, conocida por su arquitectura Art Nouveau exterior y Art Déco interior.',
    audioDuration: '4:15',
    type: 'museo',
    image:
      'https://images.unsplash.com/photo-1512813583145-ac554ac82e4a?auto=format&fit=crop&w=400&h=250&q=80',
  },
  {
    id: 'catedral',
    name: 'Catedral Metropolitana',
    category: 'Iglesia / Templo',
    dist: '0.5 km',
    lat: 19.4326,
    lng: -99.1332,
    emoji: '⛪',
    desc: 'La catedral más antigua de América Latina, sede de la Arquidiócesis Primada de México.',
    audioDuration: '5:30',
    type: 'templo',
    image:
      'https://images.unsplash.com/photo-1627918361099-c85264b4c3bf?auto=format&fit=crop&w=400&h=250&q=80',
  },
  {
    id: 'templo-mayor',
    name: 'Templo Mayor',
    category: 'Zona Arqueológica',
    dist: '0.6 km',
    lat: 19.4345,
    lng: -99.1317,
    emoji: '🏺',
    desc: 'El centro neurálgico del imperio mexica, dedicado a Huitzilopochtli y Tláloc.',
    audioDuration: '6:45',
    type: 'arqueologia',
    image:
      'https://images.unsplash.com/photo-1599940824399-b87987ceb72a?auto=format&fit=crop&w=400&h=250&q=80',
  },
  {
    id: 'palacio-nacional',
    name: 'Palacio Nacional',
    category: 'Edificio Histórico',
    dist: '0.7 km',
    lat: 19.432,
    lng: -99.1312,
    emoji: '🏰',
    desc: 'Sede del Poder Ejecutivo Federal de México, albergando increíbles murales de Diego Rivera.',
    audioDuration: '3:50',
    type: 'museo',
    image:
      'https://images.unsplash.com/photo-1585123334904-845d60e97b29?auto=format&fit=crop&w=400&h=250&q=80',
  },
  {
    id: 'torre-latino',
    name: 'Torre Latinoamericana',
    category: 'Mirador / Rascacielos',
    dist: '0.9 km',
    lat: 19.4338,
    lng: -99.1404,
    emoji: '🗼',
    desc: 'Rascacielos histórico de 44 pisos, famoso por resistir los terremotos más fuertes sin sufrir daños.',
    audioDuration: '4:10',
    type: 'rascacielos',
    image:
      'https://images.unsplash.com/photo-1509840144299-db509406a73c?auto=format&fit=crop&w=400&h=250&q=80',
  },
  {
    id: 'revolucion',
    name: 'Monumento a la Revolución',
    category: 'Monumento Histórico',
    dist: '1.8 km',
    lat: 19.4362,
    lng: -99.1546,
    emoji: '🏛️',
    desc: 'Un mausoleo dedicado a la conmemoración de la Revolución Mexicana, con un mirador de 65 metros de altura.',
    audioDuration: '5:10',
    type: 'museo',
    image:
      'https://images.unsplash.com/photo-1580979843603-5161cd896e38?auto=format&fit=crop&w=400&h=250&q=80',
  },
  {
    id: 'angel',
    name: 'Ángel de la Independencia',
    category: 'Monumento Histórico',
    dist: '3.2 km',
    lat: 19.427,
    lng: -99.1677,
    emoji: '🗽',
    desc: 'Monumento triunfal erigido para conmemorar el centenario del inicio de la Guerra de Independencia de México.',
    audioDuration: '4:50',
    type: 'museo',
    image:
      'https://images.unsplash.com/photo-1585464297275-3626a29fa2a5?auto=format&fit=crop&w=400&h=250&q=80',
  },
  {
    id: 'chapultepec',
    name: 'Castillo de Chapultepec',
    category: 'Museo / Castillo',
    dist: '4.8 km',
    lat: 19.4204,
    lng: -99.1818,
    emoji: '🏰',
    desc: 'El único castillo real de América, antigua residencia imperial y hoy sede del Museo Nacional de Historia.',
    audioDuration: '7:15',
    type: 'museo',
    image:
      'https://images.unsplash.com/photo-1601382270349-49c15bddf738?auto=format&fit=crop&w=400&h=250&q=80',
  },
  {
    id: 'tres-culturas',
    name: 'Plaza de las Tres Culturas',
    category: 'Zona Arqueológica',
    dist: '2.1 km',
    lat: 19.4517,
    lng: -99.136,
    emoji: '🏺',
    desc: 'Plaza histórica que simboliza las tres etapas de la historia de México: prehispánica, española y moderna.',
    audioDuration: '5:45',
    type: 'arqueologia',
    image:
      'https://images.unsplash.com/photo-1512813583145-ac554ac82e4a?auto=format&fit=crop&w=400&h=250&q=80',
  },
];

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

addMarkers(MONUMENTS);

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

function updateSheetUI() {
  if (!bottomSheet || !sheetChevron || !sheetBody) return;

  if (isCollapsed) {
    sheetBody.style.maxHeight = '0px';
    sheetBody.style.opacity = '0';
    sheetBody.style.pointerEvents = 'none';
    sheetChevron.style.transform = 'rotate(0deg)';
  } else {
    sheetBody.style.maxHeight = '360px';
    sheetBody.style.opacity = '1';
    sheetBody.style.pointerEvents = 'auto';
    sheetChevron.style.transform = 'rotate(180deg)';
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
    listContainer.innerHTML =
      '<p class="py-6 text-center text-[12px] text-[#a0a0a0]">No se encontraron monumentos.</p>';
    return;
  }
  list.forEach((m) => {
    const el = document.createElement('div');
    el.className =
      'flex items-center gap-3 rounded-2xl border border-black/[0.04] bg-white/60 p-2.5 backdrop-blur-md transition-all hover:bg-white/90 cursor-pointer active:scale-[0.98]';
    el.innerHTML = `
      <span class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#f5f3ff] text-xl">${m.emoji}</span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-[13px] font-bold text-[#1b1c1c]">${m.name}</p>
        <p class="text-[11px] font-medium text-[#5c5c5c]">${m.category} · <span class="font-semibold">${m.dist}</span></p>
      </div>
      <span class="flex h-7 w-7 items-center justify-center rounded-full bg-[#f5f3ff] text-[#3f043a]">
        <span class="material-symbols-outlined text-[16px]" style="font-variation-settings:'FILL' 1">play_arrow</span>
      </span>`;
    el.addEventListener('click', () => selectMonument(m.id));
    listContainer.appendChild(el);
  });
}

renderList(MONUMENTS);

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
    return JSON.parse(localStorage.getItem('edificarte_visited') || '{}');
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
  localStorage.setItem('edificarte_visited', JSON.stringify(saved));

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

searchInput?.addEventListener('input', (e) => {
  const q = (e.target as HTMLInputElement).value.toLowerCase().trim();
  const f = filterByQuery(MONUMENTS, q);
  addMarkers(f);
  renderList(f);
  if (selectedId && !f.some((m) => m.id === selectedId)) deselect();
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
    const f = filterByQuery(MONUMENTS, q);
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
    let f = filterByQuery(MONUMENTS, q);

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
        ? MONUMENTS
        : MONUMENTS.filter((m) => m.type === filter);
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
        }
      })
      .catch(() => {
        // Ignoramos silenciosamente si no está autenticado
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

const onPos = (pos: GeolocationPosition) => {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
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

startWatching();

geoStatusEl?.addEventListener('click', (e) => {
  e.stopPropagation();
  requestLocationPermission();
});

$('btn-locate')?.addEventListener('click', () => {
  if (userMarker) map.setView(userMarker.getLatLng(), 18, { animate: true });
  else requestLocationPermission();
});

// ---------------------------------------------------------------------------
// Language modal
// ---------------------------------------------------------------------------

const langModal = $('lang-modal');
const langButtons = document.querySelectorAll<HTMLElement>('.lang-btn');

if (localStorage.getItem('edificarte_lang')) {
  langModal?.classList.add('hidden');
} else {
  langModal?.classList.remove('hidden');
}

langButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const selectedLang = btn.getAttribute('data-lang');
    if (!selectedLang) return;
    localStorage.setItem('edificarte_lang', selectedLang);
    langModal?.classList.add('opacity-0');
    setTimeout(() => langModal?.classList.add('hidden'), 300);
  });
});

setTimeout(() => map.invalidateSize(), 200);
