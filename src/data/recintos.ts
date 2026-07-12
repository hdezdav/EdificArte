import recintosData from './recintos.json';

export interface Recinto {
  id: string;
  name: string;
  type: 'prehispanico' | 'colonial' | 'moderno' | 'barrio' | 'parque' | 'museo' | 'mirador';
  foundedYear: number;
  era: string;
  shortDesc: string;
  fact: string;
  wikipediaUrl: string;
  lat: number;
  lng: number;
  emoji: string;
  category: 'arqueologia' | 'museo' | 'templo' | 'rascacielos';
  // Geometría: o un círculo (con radio en metros) o un polígono custom (coords)
  radiusMeters?: number;
  polygon?: [number, number][]; // array de [lat, lng] cerrando el polígono
}

const data = recintosData as { recintos: Recinto[] };

export const RECINTOS: Recinto[] = data.recintos;

export const RECINTO_TYPES: Record<Recinto['type'], { label: string; color: string }> = {
  prehispanico: { label: 'Prehispánico', color: '#a16207' },
  colonial: { label: 'Colonial', color: '#7c2d12' },
  moderno: { label: 'Moderno', color: '#0e7490' },
  barrio: { label: 'Barrio', color: '#9d174d' },
  parque: { label: 'Parque', color: '#15803d' },
  museo: { label: 'Museo', color: '#7c1d6f' },
  mirador: { label: 'Mirador', color: '#475569' },
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