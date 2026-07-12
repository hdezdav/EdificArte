import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type {
  LatLngTuple,
  Marker as LMarker,
  Circle as LCircle,
} from 'leaflet';

console.log('[GPS DEBUG] MODULE TOP - mapa-app.ts started loading');

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
  tourId?: string;
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
import { RECINTOS, RECINTO_TYPES, RECINTO_DEFAULT_RADIUS } from '../data/recintos';
import type { Recinto } from '../data/recintos';
import { TOURS } from '../data/tours';

// Todos los monumentos son visibles en el mapa (incluyendo Pirámides del Sol
// en Teotihuacán, que aparece FUERA del zoom inicial — el usuario debe hacer
// zoom-out para verla). MONUMENTS se itera completo en markers/listas.
const MAPPABLE_MONUMENTS: typeof MONUMENTS = [...MONUMENTS];

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

// SVG silhouette icons por monumento de CDMX (custom, 24x24 viewBox).
// Solo se usan en el pin del mapa; el resto del UI sigue mostrando el emoji.
const MONUMENT_ICONS: Record<string, string> = {
  'bellas-artes': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22 L22 22"/><path d="M3 22 L3 13 L8 13 L8 22"/><path d="M16 22 L16 13 L21 13 L21 22"/><path d="M3 13 L21 13"/><path d="M7 13 L7 9 M10 13 L10 9 M14 13 L14 9 M17 13 L17 9"/><path d="M4 9 L20 9"/><path d="M4 9 A 8 4 0 0 1 20 9"/><path d="M10 5 L10 2 M14 5 L14 2"/><path d="M11 2 L13 2"/><path d="M12 2 L12 1"/></svg>`,
  'catedral': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22 L22 22"/><path d="M3 22 L3 6 L7 6 L7 22"/><path d="M17 22 L17 6 L21 6 L21 22"/><path d="M3 6 L7 6 L5 2 L7 2"/><path d="M17 6 L21 6 L19 2 L17 2"/><path d="M7 8 L17 8"/><path d="M8 22 L8 12"/><path d="M16 22 L16 12"/><path d="M8 12 Q12 12 16 12"/><path d="M9 12 A 3 4 0 0 1 15 12 Z"/><path d="M12 8 L12 6"/><path d="M10.5 4 L13.5 4 M11 2 L13 2 M12 1 L12 2"/></svg>`,
  'templo-mayor': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22 L22 22"/><path d="M3 22 L21 22 L19 18 L5 18 Z"/><path d="M5 18 L19 18 L17 14 L7 14 Z"/><path d="M7 14 L17 14 L15 10 L9 10 Z"/><path d="M9 10 L15 10 L13 6 L11 6 Z"/><path d="M11 6 L13 6 L12 4 Z"/><path d="M12 22 L12 4"/></svg>`,
  'palacio-nacional': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22 L22 22"/><path d="M3 22 L3 10 L21 10 L21 22"/><path d="M5 22 L5 14 L9 14 L9 22"/><path d="M11 22 L11 14 L13 14 L13 22"/><path d="M15 22 L15 14 L19 14 L19 22"/><path d="M3 10 L12 4 L21 10"/><path d="M11 4 L13 4 L13 8 L11 8 Z"/></svg>`,
  'torre-latino': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22 L22 22"/><path d="M5 22 L5 14 L19 14 L19 22"/><path d="M7 14 L7 8 L17 8 L17 14"/><path d="M9 8 L9 4 L15 4 L15 8"/><path d="M6 18 L8 18 M10 18 L14 18 M16 18 L18 18"/><path d="M11 4 L13 4 L13 2 L11 2 Z"/><path d="M12 2 L12 1"/></svg>`,
  'revolucion': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22 L22 22"/><path d="M4 22 L4 8"/><path d="M20 22 L20 8"/><path d="M8 22 L8 10"/><path d="M16 22 L16 10"/><path d="M4 8 Q12 4 20 8"/><path d="M8 10 L16 10"/><path d="M10 10 L10 6 Q12 4 14 6 L14 10"/><path d="M12 4 L12 2"/></svg>`,
  'angel': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22 L22 22"/><path d="M6 22 L6 18 L18 18 L18 22"/><path d="M9 18 L9 14 L15 14 L15 18"/><path d="M10 14 L10 8 L14 8 L14 14"/><path d="M10 8 L14 8 L14 5 Q12 3 10 5 Z"/><path d="M12 5 L12 3"/><path d="M9 3 L9 2 M15 3 L15 2"/><path d="M8 3 Q10 1 12 1 Q14 1 16 3"/><path d="M11 1 L13 1"/><path d="M9 1 Q7 0 5 1 M15 1 Q17 0 19 1"/></svg>`,
  'chapultepec': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22 L22 22"/><path d="M3 22 L3 9 L21 9 L21 22"/><path d="M3 9 L3 7 L5 7 L5 9"/><path d="M7 9 L7 5 L9 5 L9 9"/><path d="M11 9 L11 4 L13 4 L13 9"/><path d="M15 9 L15 5 L17 5 L17 9"/><path d="M19 9 L19 7 L21 7 L21 9"/><path d="M5 9 L5 22"/><path d="M9 9 L9 22"/><path d="M11 9 L11 22"/><path d="M13 9 L13 22"/><path d="M15 9 L15 22"/><path d="M17 9 L17 22"/><path d="M19 9 L19 22"/><path d="M11 18 L13 18 L13 22 L11 22 Z"/></svg>`,
  'tres-culturas': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22 L22 22"/><path d="M2 22 L2 18 L6 18 L6 22"/><path d="M2 18 L6 18 L5 14 L3 14 Z"/><path d="M3 14 L5 14 L4.5 11 L3.5 11 Z"/><path d="M4 11 L4 10"/><path d="M8 22 L8 14 L13 14 L13 22"/><path d="M10 14 L10 6 L11 6 L11 14"/><path d="M9 6 L12 6"/><path d="M10.5 4 L10.5 2 L11.5 2 L11.5 4"/><path d="M9 14 L9 11 A 2 1.5 0 0 1 13 11 L13 14"/><path d="M15 22 L15 8 L21 8 L21 22"/><path d="M16 10 L17 10 M16 12 L17 12 M16 14 L17 14 M16 16 L17 16 M19 10 L20 10 M19 12 L20 12 M19 14 L20 14 M19 16 L20 16"/><path d="M17 8 L19 8 L19 5 L17 5 Z"/></svg>`,
  'piramides-sol': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 22 L23 22"/><path d="M2 22 L22 22 L20 18 L4 18 Z"/><path d="M4 18 L20 18 L18.5 14 L5.5 14 Z"/><path d="M5.5 14 L18.5 14 L17 10 L7 10 Z"/><path d="M7 10 L17 10 L15 6 L9 6 Z"/><path d="M9 6 L15 6 L13 3 L11 3 Z"/><path d="M10.5 3 L13.5 3 L13 1 L11 1 Z"/><path d="M12 22 L12 1"/></svg>`,
  'hotel-virreyes': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22 L22 22"/><path d="M4 22 L4 8 L20 8 L20 22"/><path d="M3 8 L12 3 L21 8"/><path d="M6 22 L6 12 L10 12 L10 22"/><path d="M14 22 L14 12 L18 12 L18 22"/><path d="M7 16 L9 16 M7 18 L9 18 M15 16 L17 16 M15 18 L17 18"/><path d="M11 6 L11 4 M13 6 L13 4 M11 5 L13 5"/></svg>`,
};

const pinIcon = (monumentId: string, emoji: string, selected = false): L.DivIcon => {
  const svg =
    MONUMENT_ICONS[monumentId] ||
    `<span style="font-size:20px;line-height:1">${emoji}</span>`;
  return L.divIcon({
    html: `<div class="monument-pin ${selected ? 'selected' : ''}">${svg}</div>`,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -22],
  });
};

// Pin distinto para recintos históricos (más pequeño, color ámbar)
const recintoPinIcon = (recinto: Recinto): L.DivIcon => {
  const typeColor = RECINTO_TYPES[recinto.type]?.color || '#a16207';
  return L.divIcon({
    html: `<div class="recinto-pin" style="--pin-color:${typeColor}" title="${recinto.name}">
      <span class="material-symbols-outlined">museum</span>
    </div>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
};

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
const recintoMarkers: LMarker[] = [];
const recintoPolygons: (L.Circle | L.Polygon)[] = [];
let activeRouteLine: L.Polyline | null = null;

function addMarkers(list: Monument[]) {
  markers.forEach((m) => map.removeLayer(m.inst));
  markers.length = 0;
  list.forEach((m) => {
    const inst = L.marker([m.lat, m.lng], { icon: pinIcon(m.id, m.emoji) })
      .addTo(map)
      .on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectMonument(m.id);
      });
    markers.push({ id: m.id, emoji: m.emoji, inst });
  });
}

addMarkers(MAPPABLE_MONUMENTS);
addRecintoMarkers();

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
// Recintos históricos (capa secundaria, no interactúan con el bottom sheet)
// ---------------------------------------------------------------------------

function addRecintoMarkers() {
  recintoMarkers.forEach((m) => map.removeLayer(m));
  recintoMarkers.length = 0;
  recintoPolygons.forEach((p) => map.removeLayer(p));
  recintoPolygons.length = 0;
  RECINTOS.forEach((r) => {
    const typeColor = RECINTO_TYPES[r.type]?.color || '#a16207';

    // 1) Polígono delimitando el área (círculo o polígono custom)
    let shapeLayer: L.Circle | L.Polygon;
    if (r.polygon && r.polygon.length >= 3) {
      shapeLayer = L.polygon(r.polygon, {
        color: typeColor,
        weight: 2,
        opacity: 0.7,
        fillColor: typeColor,
        fillOpacity: 0.15,
        interactive: false,
        className: 'recinto-shape',
      }).addTo(map);
    } else {
      const radius = r.radiusMeters ?? RECINTO_DEFAULT_RADIUS[r.type] ?? 250;
      shapeLayer = L.circle([r.lat, r.lng], {
        radius,
        color: typeColor,
        weight: 2,
        opacity: 0.7,
        fillColor: typeColor,
        fillOpacity: 0.15,
        interactive: false,
        className: 'recinto-shape',
      }).addTo(map);
    }
    recintoPolygons.push(shapeLayer);

    // 2) Pin del recinto (siempre encima)
    const inst = L.marker([r.lat, r.lng], { icon: recintoPinIcon(r) })
      .addTo(map)
      .on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        showRecintoPopup(r);
      });
    recintoMarkers.push(inst);
  });
}

function showRecintoPopup(r: Recinto) {
  const typeLabel = RECINTO_TYPES[r.type]?.label || 'Sitio histórico';
  const html = `
    <div class="recinto-popup">
      <div class="recinto-popup-header" style="background-color:${RECINTO_TYPES[r.type]?.color || '#a16207'}">
        <span class="recinto-popup-emoji">${r.emoji}</span>
        <span class="recinto-popup-era">${typeLabel} · ${r.era}</span>
      </div>
      <div class="recinto-popup-body">
        <h3 class="recinto-popup-title">${r.name}</h3>
        <p class="recinto-popup-year">Fundado en ${r.foundedYear < 0 ? `${Math.abs(r.foundedYear)} a.C.` : r.foundedYear}</p>
        <p class="recinto-popup-desc">${r.shortDesc}</p>
        <div class="recinto-popup-fact">
          <strong>¿Sabías que…?</strong> ${r.fact}
        </div>
        <button class="recinto-popup-btn" data-recinto-id="${r.id}">Ver más detalles</button>
      </div>
    </div>
  `;
  const popup = L.popup({
    className: 'recinto-leaflet-popup',
    maxWidth: 280,
    minWidth: 240,
    autoPan: true,
    closeButton: true,
  })
    .setLatLng([r.lat, r.lng])
    .setContent(html);

  // Wire up "Ver más detalles" usando popupopen (se dispara cuando el DOM está listo)
  map.once('popupopen', (e) => {
    if (e.popup !== popup) return;
    const btn = (e.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLButtonElement>(
      `.recinto-popup-btn[data-recinto-id="${r.id}"]`
    );
    if (btn) btn.addEventListener('click', () => openRecintoModal(r.id));
  });

  popup.openOn(map);
}

// Modal fullscreen para detalle completo del recinto
function openRecintoModal(id: string) {
  const r = RECINTOS.find((x) => x.id === id);
  if (!r) return;
  activeRecintoId = id;
  const modal = $('recinto-modal');
  const title = $('recinto-modal-title');
  const emoji = $('recinto-modal-emoji');
  const era = $('recinto-modal-era');
  const year = $('recinto-modal-year');
  const desc = $('recinto-modal-fact-text');
  const fullDesc = $('recinto-modal-full-desc');
  const wiki = $('recinto-modal-wiki');
  const factContainer = $('recinto-modal-fact-container');
  const typeLabel = RECINTO_TYPES[r.type]?.label || 'Sitio histórico';

  if (title) title.textContent = r.name;
  if (emoji) emoji.textContent = r.emoji;
  if (era) era.textContent = `${typeLabel} · ${r.era}`;
  if (year)
    year.textContent = `Fundado en ${r.foundedYear < 0 ? `${Math.abs(r.foundedYear)} a.C.` : r.foundedYear}`;
  if (desc) desc.textContent = r.fact;
  if (fullDesc) fullDesc.textContent = r.shortDesc;
  if (wiki) wiki.setAttribute('href', r.wikipediaUrl);
  if (factContainer)
    factContainer.style.borderLeftColor = RECINTO_TYPES[r.type]?.color || '#a16207';

  if (modal) {
    map.closePopup();
    modal.classList.remove('hidden');
    void modal.offsetHeight;
    modal.classList.remove('opacity-0');
  }
}

function closeRecintoModal() {
  const modal = $('recinto-modal');
  if (modal) {
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 250);
  }
}

// Cerrar modal de recinto
$('recinto-modal-close')?.addEventListener('click', closeRecintoModal);
$('recinto-modal')?.addEventListener('click', (e) => {
  if (e.target === $('recinto-modal')) closeRecintoModal();
});

// Botón "Centrar en el mapa" — guarda el id activo y centra al reabrir
let activeRecintoId: string | null = null;
$('recinto-modal-locate')?.addEventListener('click', () => {
  if (activeRecintoId) {
    const r = RECINTOS.find((x) => x.id === activeRecintoId);
    if (r) {
      map.setView([r.lat, r.lng], 17, { animate: true });
      closeRecintoModal();
      // Pequeño delay para que el modal cierre antes de abrir el popup
      setTimeout(() => showRecintoPopup(r), 350);
    }
  }
});

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
  markers.forEach((x) => x.inst.setIcon(pinIcon(x.id, x.emoji, x.id === id)));
  updateVisitSection(m);

  // Mostrar / ocultar promo de recorrido guiado
  const tourPromoCard = $('tour-promo-card');
  if (tourPromoCard) {
    if (m.tourId) {
      const tour = TOURS.find((t) => t.id === m.tourId);
      if (tour) {
        const titleEl = $('tour-promo-title');
        const descEl = $('tour-promo-desc');
        const priceEl = $('tour-promo-price');
        if (titleEl) titleEl.textContent = tour.title;
        if (descEl) descEl.textContent = tour.description;
        if (priceEl) priceEl.textContent = `$${tour.pricePerPerson} MXN`;
        
        tourPromoCard.classList.remove('hidden');
        tourPromoCard.classList.add('flex');
      } else {
        tourPromoCard.classList.add('hidden');
        tourPromoCard.classList.remove('flex');
      }
    } else {
      tourPromoCard.classList.add('hidden');
      tourPromoCard.classList.remove('flex');
    }
  }

  viewList?.classList.add('hidden');
  viewDetail?.classList.remove('hidden');

  isCollapsed = false;
  updateSheetUI();
}

function deselect() {
  selectedId = null;
  stopAudio();
  markers.forEach((x) => x.inst.setIcon(pinIcon(x.id, x.emoji, false)));
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
      .then((data: UnlockBadgeResponse) => {
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

interface UnlockBadgeResponse {
  success: boolean;
  isGuest?: boolean;
  badgeId?: number;
  pointsEarned?: number;
  totalPoints?: number;
  txHash?: string;
  mode?: 'mock' | 'live';
  message?: string;
  errorMessage?: string;
}

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
let permissionDenied = false; // true si el usuario rechazó permisos permanentemente

const onPos = (pos: GeolocationPosition) => {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;

  // Si obtuvimos posición, el usuario claramente autorizó — resetear flag
  permissionDenied = false;

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
  if (err.code === 1) {
    // Permiso denegado — no volver a pedir automáticamente
    permissionDenied = true;
    setGeo('error', 'Permiso denegado — tocá para ver cómo activarlo');
  } else {
    setGeo('error', 'Sin señal');
  }
};

function startWatching() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  if (!('geolocation' in navigator)) {
    setGeo('error', 'GPS no soportado');
    return;
  }
  setGeo('loading', 'Localizando...');

  // Primer intento: alta precisión con timeout corto.
  // Si falla por timeout (no por permiso denegado), reintentamos con
  // enableHighAccuracy:false y timeout más largo — funciona mejor en interiores.
  const tryWatch = (highAccuracy: boolean) => {
    watchId = navigator.geolocation.watchPosition(onPos, (err) => {
      if (err.code === 3 /* TIMEOUT */ && highAccuracy && watchId !== null) {
        // Fallback: reintentar con menor precisión
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        tryWatch(false);
        return;
      }
      onErr(err);
    }, {
      enableHighAccuracy: highAccuracy,
      maximumAge: 5000,
      timeout: highAccuracy ? 10000 : 20000,
    });
  };
  tryWatch(true);
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

  // Si ya rechazaron permiso, no volver a abrir el prompt — mostrar instrucciones
  if (permissionDenied) {
    showPermissionInstructions();
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
  // Limpiar flag ANTES de pedir permiso para que el fallback polling
  // no vuelva a disparar el prompt si el evento se procesa tarde.
  safeSet('edificarte_request_gps_pending', 'false');
  window.__edificarteGpsPending = false;

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

// NO auto-start: navigator.geolocation en iOS Safari requiere gesto de usuario
// para abrir el prompt de permiso. Arrancar watchPosition on-load hace que
// el prompt se rechace silenciosamente (code 1) y permissionDenied queda
// sticky para toda la sesión. El GPS se inicia únicamente cuando el usuario
// hace click en un botón o el welcome modal lo pide.

// Listen for the inline modal script to signal modals are done
window.addEventListener('edificarte-request-gps', () => {
  // Respetar decisión previa del usuario — no reabrir prompt si ya rechazó
  if (permissionDenied) return;
  triggerLocationPrompt();
});
// El listener de 'edificarte-modals-done' se registra más abajo (después
// de definir notifyRemoteSites). NO auto-arrancamos el watch aquí:
// navigator.geolocation requiere user gesture en iOS Safari, y este evento
// se dispara desde el flujo de modales sin gesto cuando el welcome modal
// ya fue visto en visitas previas. El GPS se inicia únicamente cuando el
// usuario clickea explícitamente #geo-status o #btn-locate.

// Fallback anti-race-condition: el inline script de mapa.astro puede dispatchar
// el evento ANTES de que este módulo ESM registre el listener. Chequeamos
// el flag UNA sola vez al cargar para no generar prompts duplicados.
function checkPendingGpsRequest() {
  const pending =
    safeGet('edificarte_request_gps_pending') === 'true' ||
    window.__edificarteGpsPending === true;
  if (pending && !permissionDenied) {
    triggerLocationPrompt();
  }
}
// Esperar a que el evento sea procesado por el listener; si llegó antes,
// el flag se limpió en triggerLocationPrompt() y este check es no-op.
setTimeout(checkPendingGpsRequest, 1500);

geoStatusEl?.addEventListener('click', (e) => {
  e.stopPropagation();
  console.log('[GPS DEBUG] geo-status clicked, userMarker:', !!userMarker, 'permissionDenied:', permissionDenied);
  // Si ya tenemos marcador de usuario (gps activo), centrar el mapa
  if (userMarker) {
    map.setView(userMarker.getLatLng(), 17, { animate: true });
    return;
  }
  // Si la última vez el usuario rechazó, igual le damos la oportunidad
  // de reintentar: reseteamos el flag y dejamos que requestLocationPermission
  // consulte el estado real del navegador. Si la denegación persiste, el
  // navegador NO abrirá el prompt otra vez y caemos en el flujo de instrucciones.
  if (permissionDenied) {
    permissionDenied = false;
  }
  requestLocationPermission();
});

$('btn-locate')?.addEventListener('click', () => {
  console.log('[GPS DEBUG] btn-locate clicked, userMarker:', !!userMarker, 'permissionDenied:', permissionDenied);
  if (userMarker) map.setView(userMarker.getLatLng(), 18, { animate: true });
  else if (permissionDenied) showPermissionInstructions();
  else requestLocationPermission();
});

// ---------------------------------------------------------------------------
// Auto-start GPS cuando el usuario ya pasó por los modales de bienvenida
// ---------------------------------------------------------------------------
// En la mayoría de visitas el welcome modal no se muestra (queda persistido
// en localStorage), entonces el único disparador del GPS — el botón "Activar
// GPS y Comenzar" — nunca se ejecuta y el indicador queda "Inactivo" para
// siempre aunque el navegador ya tenga el permiso otorgado.
//
// Si el usuario ya eligió idioma y ya vio el welcome, significa que en una
// visita previa completó el flujo de opt-in al GPS. Llamamos startWatching()
// directamente: si el permiso sigue granted, el navegador devuelve la posición
// sin abrir ningún prompt. Si fue revocado entre visitas, el browser maneja
// el error de forma estándar (el usuario verá "Permiso denegado" en el
// indicador y podrá tocarlo para ver instrucciones de rehabilitación).
//
// Esto preserva el workaround de iOS Safari: el flag `permissionDenied`
// protege contra el bug documentado en líneas 1130-1134 (prompt rechazado
// silenciosamente sin gesto). Si en esta sesión ya rechazaste explícitamente,
// no auto-iniciamos.
function tryAutoStartGps() {
  console.log('[GPS DEBUG] tryAutoStartGps running');
  console.log('[GPS DEBUG] permissionDenied:', permissionDenied);
  console.log('[GPS DEBUG] geolocation in navigator:', 'geolocation' in navigator);
  console.log('[GPS DEBUG] hasLang:', safeGet('edificarte_lang'));
  console.log('[GPS DEBUG] hasWelcome:', safeGet('edificarte_welcome_shown'));
  if (permissionDenied) {
    console.log('[GPS DEBUG] skipped: permissionDenied is true');
    return;
  }
  if (!('geolocation' in navigator)) {
    console.log('[GPS DEBUG] skipped: no geolocation API');
    return;
  }
  const hasLang = safeGet('edificarte_lang');
  const hasWelcome = safeGet('edificarte_welcome_shown');
  if (hasLang && hasWelcome) {
    console.log('[GPS DEBUG] calling startWatching()');
    startWatching();
  } else {
    console.log('[GPS DEBUG] skipped: lang/welcome not set');
  }
}
tryAutoStartGps();

// Toast reusable para mensajes informativos al usuario
function showToast(message: string, variant: 'info' | 'success' | 'warn' = 'info') {
  const colorMap = {
    info: 'border-blue-200/50 bg-blue-50/95 text-blue-900',
    success: 'border-emerald-200/50 bg-emerald-50/95 text-emerald-900',
    warn: 'border-amber-200/50 bg-amber-50/95 text-amber-900',
  };
  const iconMap = {
    info: 'info',
    success: 'check_circle',
    warn: 'warning',
  };
  const toast = document.createElement('div');
  toast.className = `fixed top-6 left-1/2 -translate-x-1/2 z-[9999] flex max-w-[calc(100vw-32px)] items-start gap-2.5 rounded-2xl border px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.15)] backdrop-blur-md transition-all duration-500 scale-90 opacity-0 ${colorMap[variant]}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `
    <span class="material-symbols-outlined mt-0.5 text-[18px] flex-shrink-0">${iconMap[variant]}</span>
    <span class="text-[12px] font-medium leading-snug">${message}</span>
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('scale-90', 'opacity-0');
    toast.classList.add('scale-100', 'opacity-100');
  });
  setTimeout(() => {
    toast.classList.remove('scale-100', 'opacity-100');
    toast.classList.add('scale-90', 'opacity-0');
    setTimeout(() => toast.remove(), 500);
  }, 6000);
}

// Notificar al usuario que hay sitios fuera del zoom inicial (ej. Pirámides del Sol en Teotihuacán)
function notifyRemoteSites() {
  const remoteMonuments = MONUMENTS.filter((m) => m.type === 'sitio-remoto');
  if (remoteMonuments.length === 0) return;
  const names = remoteMonuments.map((m) => m.name).join(', ');
  showToast(
    `Hay ${remoteMonuments.length} sitio${remoteMonuments.length > 1 ? 's' : ''} turístico${
      remoteMonuments.length > 1 ? 's' : ''
    } fuera del centro (${names}). Hacé zoom-out o arrastrá el mapa para verlo${
      remoteMonuments.length > 1 ? 's' : ''
    }.`,
    'info'
  );
}

setTimeout(() => map.invalidateSize(), 200);

// Mostrar el aviso después de que el mapa termine de cargar
window.addEventListener('edificarte-modals-done', () => {
  setTimeout(notifyRemoteSites, 800);
});
// Si ya estaba en el mapa sin modales, mostrar inmediatamente
if (safeGet('edificarte_lang') && safeGet('edificarte_welcome_shown')) {
  setTimeout(notifyRemoteSites, 1200);
}

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
    if (err instanceof Error && err.name === 'AbortError') {
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
window.addEventListener('ai-route-generated', (e: Event) => {
  const route = (e as CustomEvent<{ route?: unknown }>).detail?.route;
  if (Array.isArray(route)) {
    drawRoute(route);
  }
});

// Escuchar evento personalizado para reproducir audioguía
window.addEventListener('ai-play-audio', (e: Event) => {
  const monumentId = (e as CustomEvent<{ monumentId?: string }>).detail?.monumentId;
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

// ---------------------------------------------------------------------------
// Gestión de Reserva de Recorridos Guiados
// ---------------------------------------------------------------------------

const tourModal = $('tour-modal');
const tourModalClose = $('tour-modal-close');
const tourModalTitle = $('tour-modal-title');
const tourModalSubtitle = $('tour-modal-subtitle');
const tourIdInput = $<HTMLInputElement>('tour-id-input');
const tourForm = $<HTMLFormElement>('tour-reservation-form');
const tourTotalEl = $('tour-total');
const tourSuccess = $('tour-success-state');
const tourSuccessClose = $('tour-success-close');
const tourPeopleInput = $<HTMLInputElement>('tour-people');
const tourSubmitBtn = $<HTMLButtonElement>('tour-submit-btn');

const TOUR_PRICE = 480;

function openTourModal(tourId: string, title: string, subtitle: string) {
  if (!tourModal) return;
  if (tourIdInput) tourIdInput.value = tourId;
  if (tourModalTitle) tourModalTitle.textContent = title;
  if (tourModalSubtitle) tourModalSubtitle.textContent = subtitle;
  updateTourTotal();
  if (tourSuccess) tourSuccess.classList.add('hidden');
  if (tourForm) tourForm.classList.remove('hidden');
  
  tourModal.classList.remove('hidden');
  void tourModal.offsetHeight;
  tourModal.classList.remove('opacity-0');
  document.body.classList.add('modal-open');
  if (tourPeopleInput) tourPeopleInput.value = '2';
  
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateInput = $<HTMLInputElement>('tour-date');
  if (dateInput) dateInput.min = tomorrow.toISOString().split('T')[0];
}

function closeTourModal() {
  if (!tourModal) return;
  tourModal.classList.add('opacity-0');
  setTimeout(() => {
    tourModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }, 250);
}

function updateTourTotal() {
  const n = parseInt(tourPeopleInput?.value || '1', 10) || 1;
  if (tourTotalEl) {
    tourTotalEl.textContent = `$${(n * TOUR_PRICE).toLocaleString('es-MX')} MXN`;
  }
}

tourPeopleInput?.addEventListener('input', updateTourTotal);
tourModalClose?.addEventListener('click', closeTourModal);
tourSuccessClose?.addEventListener('click', closeTourModal);
tourModal?.addEventListener('click', (e) => {
  if (e.target === tourModal) closeTourModal();
});

tourForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!tourSubmitBtn || !tourForm) return;

  const tourId = tourIdInput?.value || '';
  const tour = TOURS.find((t) => t.id === tourId);
  const tourTitle = tour?.title || 'Tour';
  const tourImage = tour?.image || '';

  const formData = new FormData(tourForm);
  const data = {
    tourId,
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    date: formData.get('date'),
    people: parseInt(formData.get('people') as string, 10) || 1,
    notes: formData.get('notes') || '',
  };

  if (!data.name || !data.email || !data.phone || !data.date || !data.people) {
    alert('Por favor completá todos los campos obligatorios.');
    return;
  }

  tourSubmitBtn.disabled = true;
  const originalText = tourSubmitBtn.innerHTML;
  tourSubmitBtn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> Enviando...';

  try {
    const response = await fetch('/api/reservar-tour', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) throw new Error('Error en el servidor');

    const result = await response.json();

    // Guardar la reserva en localStorage edificarte_reservations
    try {
      const STORAGE_KEY = 'edificarte_reservations';
      const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as Array<Record<string, unknown>>;
      const reservation = {
        id: result.reservationId || `RES-${Date.now()}`,
        tourId: data.tourId,
        tourTitle,
        tourImage,
        name: data.name,
        email: data.email,
        phone: data.phone,
        date: data.date,
        people: data.people,
        totalMXN: result.totalMXN || 0,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      existing.push(reservation);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    } catch (storageErr) {
      console.warn('No se pudo guardar la reserva en localStorage:', storageErr);
    }

    if (tourSuccess) tourSuccess.classList.remove('hidden');
    if (tourForm) tourForm.classList.add('hidden');
    tourForm.reset();
    if (tourPeopleInput) tourPeopleInput.value = '2';
  } catch (err) {
    console.error('Error al reservar:', err);
    alert('Hubo un error al enviar la solicitud. Por favor intentá de nuevo o contactanos por WhatsApp.');
  } finally {
    tourSubmitBtn.disabled = false;
    tourSubmitBtn.innerHTML = originalText;
  }
});

// Click en el botón de reservar de la tarjeta de promoción en el panel
$('btn-book-tour')?.addEventListener('click', () => {
  if (!selectedId) return;
  const m = MONUMENTS.find((x) => x.id === selectedId);
  if (!m || !m.tourId) return;
  const tour = TOURS.find((t) => t.id === m.tourId);
  if (!tour) return;
  openTourModal(tour.id, tour.title, tour.meetingPoint || '');
});

