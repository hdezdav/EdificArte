export interface Monument {
  id: string;
  name: string;
  category: string;
  dist: string;
  lat: number;
  lng: number;
  emoji: string;
  desc: string;
  audioDuration: string;
  type: 'museo' | 'templo' | 'arqueologia' | 'rascacielos';
  image: string;
}

export const MONUMENTS: Monument[] = [
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
