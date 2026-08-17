import type { Locale } from '../lib/i18n';

/**
 * Monument - a landmark, museum, temple, park, viewpoint, or archaeological
 * site cataloged in TuriMap.
 *
 * NOTE on scope: this seed currently contains only the legacy CDMX entries.
 * Multi-city seed grows from here via the future admin panel backed by
 * Supabase (see supabase/schema.sql). The shape below mirrors the
 * `public.places` table so an import path can be written without further
 * reshaping.
 */
export interface Monument {
  id: string;
  name: string;                  // default name (fallback when no translation)
  category: string;
  dist: string;                  // human-readable distance from default center
  lat: number;
  lng: number;
  emoji: string;
  desc: string;                  // default description
  audioDuration: string;
  type: 'museo' | 'templo' | 'arqueologia' | 'rascacielos' | 'sitio-remoto';
  image: string;
  // Multi-city support:
  country: string;               // ISO 3166-1 alpha-2 (e.g. "MX")
  city: string;
  currency: 'USD' | 'EUR' | 'MXN' | 'GBP' | 'JPY' | string;
  // Optional: locale-specific overrides
  translations?: Partial<Record<Locale, { name: string; desc: string; category?: string }>>;
  // Opcionales para experiencias especiales:
  videoUrl?: string;       // VR / 360 video link
  isVRAvailable?: boolean; // Si tiene experiencia VR
  tourId?: string;         // ID de recorrido guiado adquirible
  audioUrl?: string;       // Path del audio (en /public/audio/) si está disponible
}

export const MONUMENTS: Monument[] = [
  {
    id: 'bellas-artes',
    name: 'Palace of Fine Arts',
    category: 'Museum / Theater',
    dist: '0.3 km',
    lat: 19.4352,
    lng: -99.1412,
    emoji: '🏛️',
    desc: 'One of the world\'s most famous opera houses, known for its Art Nouveau exterior and Art Deco interior.',
    audioDuration: '4:15',
    type: 'museo',
    country: 'MX',
    city: 'Mexico City',
    currency: 'MXN',
    translations: {
      es: {
        name: 'Palacio de Bellas Artes',
        desc: 'Una de las casas de ópera más famosas del mundo, conocida por su arquitectura Art Nouveau exterior y Art Déco interior.',
      },
    },
    image:
      'https://images.unsplash.com/photo-1604340923514-0a2b69fcc51f?q=80&w=1075&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  },
  {
    id: 'catedral',
    name: 'Metropolitan Cathedral',
    category: 'Church / Temple',
    dist: '0.5 km',
    lat: 19.4326,
    lng: -99.1332,
    emoji: '⛪',
    desc: 'The oldest cathedral in Latin America, seat of the Primate Archdiocese.',
    audioDuration: '5:30',
    type: 'templo',
    country: 'MX',
    city: 'Mexico City',
    currency: 'MXN',
    translations: {
      es: {
        name: 'Catedral Metropolitana',
        desc: 'La catedral más antigua de América Latina, sede de la Arquidiócesis Primada de México.',
      },
    },
    image:
      'https://images.unsplash.com/photo-1610220260088-07fafc859f87?q=80&w=1074&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  },
  {
    id: 'templo-mayor',
    name: 'Templo Mayor',
    category: 'Archaeological Site',
    dist: '0.6 km',
    lat: 19.4345,
    lng: -99.1317,
    emoji: '🏺',
    desc: 'The nerve center of the Mexica empire, dedicated to Huitzilopochtli and Tláloc.',
    audioDuration: '6:45',
    type: 'arqueologia',
    country: 'MX',
    city: 'Mexico City',
    currency: 'MXN',
    translations: {
      es: {
        name: 'Templo Mayor',
        desc: 'El centro neurálgico del imperio mexica, dedicado a Huitzilopochtli y Tláloc.',
      },
    },
    image:
      'https://content-historia.nationalgeographic.com.es/medio/2024/04/04/imagen-de-las-ruinas-del-templo-mayor-de-la-antigua-tenochtitlan-y-al-fondo-la-catedral-metropolitana-de-ciudad-de-mexico_513eb790_240404143954_1280x853.jpg',
    tourId: 'templo-mayor',
  },
  {
    id: 'palacio-nacional',
    name: 'National Palace',
    category: 'Historic Building',
    dist: '0.7 km',
    lat: 19.432,
    lng: -99.1312,
    emoji: '🏰',
    desc: 'Seat of the Federal Executive, housing stunning murals by Diego Rivera.',
    audioDuration: '3:50',
    type: 'museo',
    country: 'MX',
    city: 'Mexico City',
    currency: 'MXN',
    translations: {
      es: {
        name: 'Palacio Nacional',
        desc: 'Sede del Poder Ejecutivo Federal de México, albergando increíbles murales de Diego Rivera.',
      },
    },
    image:
      'https://images.unsplash.com/photo-1564975930846-3da8c44284a5?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  },
  {
    id: 'torre-latino',
    name: 'Torre Latinoamericana',
    category: 'Viewpoint / Skyscraper',
    dist: '0.9 km',
    lat: 19.4338,
    lng: -99.1404,
    emoji: '🗼',
    desc: 'Historic 44-story skyscraper, famous for withstanding the strongest earthquakes without damage.',
    audioDuration: '4:10',
    type: 'rascacielos',
    country: 'MX',
    city: 'Mexico City',
    currency: 'MXN',
    translations: {
      es: {
        name: 'Torre Latinoamericana',
        desc: 'Rascacielos histórico de 44 pisos, famoso por resistir los terremotos más fuertes sin sufrir daños.',
      },
    },
    image:
      'https://plus.unsplash.com/premium_photo-1754211681560-19c9f3b9bb85?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  },
  {
    id: 'revolucion',
    name: 'Monument to the Revolution',
    category: 'Historic Monument',
    dist: '1.8 km',
    lat: 19.4362,
    lng: -99.1546,
    emoji: '🏛️',
    desc: 'A mausoleum commemorating the Mexican Revolution, with a 65-meter observation deck.',
    audioDuration: '5:10',
    type: 'museo',
    country: 'MX',
    city: 'Mexico City',
    currency: 'MXN',
    translations: {
      es: {
        name: 'Monumento a la Revolución',
        desc: 'Un mausoleo dedicado a la conmemoración de la Revolución Mexicana, con un mirador de 65 metros de altura.',
      },
    },
    image:
      'https://images.unsplash.com/photo-1611164589008-bf38fc66118c?q=80&w=1188&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  },
  {
    id: 'angel',
    name: 'Angel of Independence',
    category: 'Historic Monument',
    dist: '3.2 km',
    lat: 19.427,
    lng: -99.1677,
    emoji: '🗽',
    desc: 'Triumphal monument erected to commemorate the centennial of the beginning of the War of Independence.',
    audioDuration: '4:50',
    type: 'museo',
    country: 'MX',
    city: 'Mexico City',
    currency: 'MXN',
    translations: {
      es: {
        name: 'Ángel de la Independencia',
        desc: 'Monumento triunfal erigido para conmemorar el centenario del inicio de la Guerra de Independencia de México.',
      },
    },
    image:
      'https://images.unsplash.com/photo-1682916114863-ba2f7b7d39c9?q=80&w=687&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  },
  {
    id: 'chapultepec',
    name: 'Chapultepec Castle',
    category: 'Museum / Castle',
    dist: '4.8 km',
    lat: 19.4204,
    lng: -99.1818,
    emoji: '🏰',
    desc: 'The only royal castle in the Americas, former imperial residence and now home to the National Museum of History.',
    audioDuration: '7:15',
    type: 'museo',
    country: 'MX',
    city: 'Mexico City',
    currency: 'MXN',
    translations: {
      es: {
        name: 'Castillo de Chapultepec',
        desc: 'El único castillo real de América, antigua residencia imperial y hoy sede del Museo Nacional de Historia.',
      },
    },
    image:
      'https://images.unsplash.com/photo-1693925369183-a815a771f7d5?q=80&w=735&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  },
  {
    id: 'piramides-sol',
    name: 'Pyramid of the Sun',
    category: 'Archaeological Site · Teotihuacan',
    dist: '~50 km',
    lat: 19.6925,
    lng: -98.8438,
    emoji: '🔺',
    desc: 'The largest structure at Teotihuacan, built in the 1st century CE. It measures 65 meters tall and was dedicated to the sun god. Tour this archaeological site via an immersive virtual reality experience.',
    audioDuration: '8:00',
    type: 'sitio-remoto',
    country: 'MX',
    city: 'Teotihuacan',
    currency: 'MXN',
    translations: {
      es: {
        name: 'Pirámides del Sol',
        desc: 'La Pirámide del Sol es la estructura más grande de Teotihuacán, construida en el siglo I d.C. Mide 65 metros de altura y fue dedicada al dios sol. Recorré este sitio arqueológico en una experiencia inmersiva en realidad virtual.',
      },
    },
    image: 'https://plus.unsplash.com/premium_photo-1697730030977-ea0505bd45ac?q=80&w=1171&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    videoUrl: 'https://www.youtube.com/embed/Wq9BpTOjE1E',
    isVRAvailable: true,
  },
  {
    id: 'hotel-virreyes',
    name: 'Hotel Virreyes',
    category: 'Hotel Boutique · Centro Histórico',
    dist: '1.2 km',
    lat: 19.427015,
    lng: -99.141775,
    emoji: '🏨',
    desc: 'Boutique hotel located at Avenida José María Izazaga 8, Mexico City. A contemporary design sanctuary honoring Mexican history and culture, featuring thematic rooms inspired by the country\'s great artists and architects.',
    audioDuration: '1:50',
    audioUrl: '/audio/hotel.mp3',
    type: 'museo',
    country: 'MX',
    city: 'Mexico City',
    currency: 'MXN',
    translations: {
      es: {
        name: 'Hotel Virreyes',
        desc: 'Hotel boutique ubicado en Avenida José María Izazaga 8, alcaldía Cuauhtémoc, Ciudad de México. Un refugio de diseño contemporáneo que rinde homenaje a la historia y la cultura mexicana, con habitaciones temáticas inspiradas en los grandes artistas y arquitectos del país.',
        category: 'Hotel Boutique · Centro Histórico',
      },
    },
    image:
      'https://www.mexicodesconocido.com.mx/wp-content/uploads/2020/11/46171515_319810011943872_8112943512745410560_n.jpg',
  },
];