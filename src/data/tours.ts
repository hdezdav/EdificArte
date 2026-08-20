import type { Locale } from '../lib/i18n';

/**
 * Tour - a bookable guided experience. Currency is free-form (ISO 4217).
 * For multi-city support, each tour carries `city`, `country` (ISO alpha-2),
 * and optional `translations` for locale-specific copy.
 */
export interface Tour {
  id: string;
  title: string;
  subtitle: string;
  duration: string;             // human-readable, e.g. "4-5 hours"
  pricePerPerson: number;       // in minor units not required - use as-is for display
  currency: string;             // ISO 4217: 'USD' | 'EUR' | 'MXN' | ...
  image: string;
  highlights: string[];
  description: string;
  meetingPoint: string;
  city: string;
  country: string;              // ISO 3166-1 alpha-2
  guide: {
    id?: string;
    name: string;
    title: string;
    bio: string;
    avatar?: string;
    rating?: number;
    languages?: string[];
  };
  category: 'tour';
  translations?: Partial<Record<Locale, { title: string; subtitle?: string; description?: string; meetingPoint?: string; guideBio?: string }>>;
}

export interface TourGuide {
  id: string;
  name: string;
  title: string;
  institution: string;
  bio: string;
  avatar: string;
  rating: number;
  reviewCount: number;
  toursCount: number;
  languages: string[];
  specialties: string[];
  badge: string;
  translations?: {
    es: { title: string; institution: string; bio: string; badge: string; specialties: string[] };
    en: { title: string; institution: string; bio: string; badge: string; specialties: string[] };
  };
}

export const TOUR_GUIDES: TourGuide[] = [
  {
    id: 'henryk-kocyba',
    name: 'Mtro. Henryk Karol Kocyba',
    title: 'Anthropologist and Archaeologist',
    institution: 'University of Warsaw',
    bio: 'Graduate of the University of Warsaw. Specialist in the History of Mexico, with extensive research focused on Mesoamerican religion, cosmovision, and pre-Hispanic art.',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&h=400&q=80',
    rating: 4.98,
    reviewCount: 142,
    toursCount: 4,
    languages: ['ES', 'EN', 'PL'],
    specialties: ['Pre-Hispanic Art', 'Mesoamerican Cosmovision', 'Colonial Monasteries'],
    badge: 'Certified Guide',
    translations: {
      es: {
        title: 'Antropólogo y Arqueólogo',
        institution: 'Universidad de Varsovia',
        bio: 'Egresado de la Universidad de Varsovia. Especialista en Historia de México, sus investigaciones destacan en religión, cosmovisión y arte prehispánico.',
        badge: 'Guía Certificado',
        specialties: ['Arte Prehispánico', 'Cosmovisión Mexica', 'Ex-Conventos Coloniales'],
      },
      en: {
        title: 'Anthropologist and Archaeologist',
        institution: 'University of Warsaw',
        bio: 'Graduate of the University of Warsaw. Specialist in the History of Mexico, with extensive research focused on Mesoamerican religion, cosmovision, and pre-Hispanic art.',
        badge: 'Certified Guide',
        specialties: ['Pre-Hispanic Art', 'Mesoamerican Cosmovision', 'Colonial Monasteries'],
      },
    },
  },
];

export const TOURS: Tour[] = [
  {
    id: 'coyoacan-anahuacalli',
    title: 'Route 1: Coyoacan Historic Center and Anahuacalli Museum',
    subtitle: 'Coyoacan and Anahuacalli Museum',
    duration: '4-5 hours',
    pricePerPerson: 480,
    currency: 'MXN',
    city: 'Mexico City',
    country: 'MX',
    image: 'https://offloadmedia.feverup.com/cdmxsecreta.com/wp-content/uploads/2026/02/10151742/Museo-Anahuacalli.jpg',
    highlights: [
      'Entrance on Francisco Sosa, the most beautiful street in Coyoacan',
      'Jardin Centenario',
      'Ex-Dominican convent and San Juan Bautista parish',
      'Capilla de la Conchita',
      'Frida Kahlo Museum (La Casa Azul)',
      'Anahuacalli Museum',
    ],
    description: 'Tour through the historic heart of Coyoacan, from the most emblematic street to the basalt pyramid designed by Diego Rivera to house his pre-Hispanic art collection.',
    meetingPoint: 'Plaza de la Conchita, Coyoacan',
    guide: {
      id: 'henryk-kocyba',
      name: 'Mtro. Henryk Karol Kocyba',
      title: 'Anthropologist and archaeologist',
      bio: 'Graduate of the University of Warsaw. Specialist in the History of Mexico, with research focused on religion, cosmology, and art.',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&h=400&q=80',
      rating: 4.98,
      languages: ['ES', 'EN', 'PL'],
    },
    translations: {
      es: {
        title: 'Recorrido 1: Centro Histórico de Coyoacán y Museo Anahuacalli',
        subtitle: 'Coyoacán y Museo Anahuacalli',
        description: 'Recorrido por el corazón histórico de Coyoacán, desde la calle más emblemática hasta la pirámide de basalto diseñada por Diego Rivera para resguardar su colección de arte prehispánico.',
        meetingPoint: 'Plaza de la Conchita, Coyoacán',
        guideBio: 'Egresado de la Universidad de Varsovia. Especialista en Historia de México, sus investigaciones destacan en religión, cosmovisión y arte.',
      },
    },
    category: 'tour',
  },
  {
    id: 'san-angel-chimalistac',
    title: 'Route 2: San Angel and Chimalistac',
    subtitle: 'San Angel and Chimalistac',
    duration: '4 hours',
    pricePerPerson: 480,
    currency: 'MXN',
    city: 'Mexico City',
    country: 'MX',
    image: 'https://oem.com.mx/elsoldemexico/img/13792936/1720504512/BASE_LANDSCAPE/1200/image.jpg',
    highlights: [
      'Ex-convento del Carmen',
      'Plaza de San Jacinto with Casa del Risco (Isidro Fabela Cultural Center)',
      'Temple and ex-convent of San Jacinto',
      'San Sebastian Martir parish in Chimalistac',
      'Mercado de flores "Melchor Muzquiz"',
    ],
    description: 'Tour through the most beautiful colonial neighborhoods in southern Mexico City, with 17th-century convents and the famous flower market.',
    meetingPoint: 'Ex-convento del Carmen, San Angel',
    guide: {
      id: 'henryk-kocyba',
      name: 'Mtro. Henryk Karol Kocyba',
      title: 'Anthropologist and archaeologist',
      bio: 'Graduate of the University of Warsaw. Specialist in the History of Mexico, with research focused on religion, cosmology, and art.',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&h=400&q=80',
      rating: 4.98,
      languages: ['ES', 'EN', 'PL'],
    },
    translations: {
      es: {
        title: 'Recorrido 2: San Ángel y Chimalistac',
        subtitle: 'San Ángel y Chimalistac',
        description: 'Recorrido por los barrios coloniales más bellos del sur de la CDMX, sus ex conventos del siglo XVII y el famoso mercado de flores.',
        meetingPoint: 'Ex convento del Carmen, San Ángel',
        guideBio: 'Egresado de la Universidad de Varsovia. Especialista en Historia de México, sus investigaciones destacan en religión, cosmovisión y arte.',
      },
    },
    category: 'tour',
  },
  {
    id: 'xochimilco',
    title: 'Route 3: Xochimilco',
    subtitle: 'Chinampas of Xochimilco',
    duration: '3-4 hours',
    pricePerPerson: 480,
    currency: 'MXN',
    city: 'Mexico City',
    country: 'MX',
    image: 'https://offloadmedia.feverup.com/cdmxsecreta.com/wp-content/uploads/2023/03/06125107/Que-hacer-en-xochimilco.jpg',
    highlights: [
      'Tour through the chinampas of Xochimilco (UNESCO World Heritage)',
      'Pre-Hispanic cultivation techniques',
      'How a city and its water-borne crops were built',
    ],
    description: 'Tour of the pre-Hispanic chinampa system of Xochimilco, a UNESCO World Heritage site. Learn how the Mexica built an agricultural city on the water. The trajinera boat service is independent (Cuemanco embarcadero).',
    meetingPoint: 'Paradero Cuemanco, Xochimilco',
    guide: {
      id: 'henryk-kocyba',
      name: 'Mtro. Henryk Karol Kocyba',
      title: 'Anthropologist and archaeologist',
      bio: 'Graduate of the University of Warsaw. Specialist in the History of Mexico, with research focused on religion, cosmology, and art.',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&h=400&q=80',
      rating: 4.98,
      languages: ['ES', 'EN', 'PL'],
    },
    translations: {
      es: {
        title: 'Recorrido 3: Xochimilco',
        subtitle: 'Chinampas de Xochimilco',
        description: 'Recorrido por el sistema de chinampas prehispánico de Xochimilco, declarado Patrimonio Cultural de la Humanidad. Aprendé cómo los mexicas construyeron una ciudad agrícola sobre el agua. El servicio de trajineras es independiente (paradero Cuemanco).',
        meetingPoint: 'Paradero Cuemanco, Xochimilco',
        guideBio: 'Egresado de la Universidad de Varsovia. Especialista en Historia de México, sus investigaciones destacan en religión, cosmovisión y arte.',
      },
    },
    category: 'tour',
  },
  {
    id: 'templo-mayor',
    title: 'Historic Route: Templo Mayor and Mexica Center',
    subtitle: 'Templo Mayor and Surroundings',
    duration: '3 hours',
    pricePerPerson: 480,
    currency: 'MXN',
    city: 'Mexico City',
    country: 'MX',
    image: 'https://content-historia.nationalgeographic.com.es/medio/2024/04/04/imagen-de-las-ruinas-del-templo-mayor-de-la-antigua-tenochtitlan-y-al-fondo-la-catedral-metropolitana-de-ciudad-de-mexico_513eb790_240404143954_1280x853.jpg',
    highlights: [
      'Tour of the Templo Mayor ruins',
      'Guided visit to the Templo Mayor Museum',
      'Explanation of Mexica cosmogony and sacred monoliths',
    ],
    description: 'A journey to the heart of the Aztec empire. Explore the sacred precinct of Tenochtitlan guided by an expert archaeologist.',
    meetingPoint: 'Main entrance of Templo Mayor (Plaza del Seminario)',
    guide: {
      id: 'henryk-kocyba',
      name: 'Mtro. Henryk Karol Kocyba',
      title: 'Anthropologist and archaeologist',
      bio: 'Graduate of the University of Warsaw. Specialist in the History of Mexico, with research focused on religion, cosmology, and art.',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&h=400&q=80',
      rating: 4.98,
      languages: ['ES', 'EN', 'PL'],
    },
    translations: {
      es: {
        title: 'Recorrido Histórico: Templo Mayor y Centro Mexica',
        subtitle: 'Templo Mayor y Alrededores',
        description: 'Un viaje al corazón del imperio azteca. Explora el recinto sagrado de Tenochtitlan de la mano de un arqueólogo experto.',
        meetingPoint: 'Entrada principal del Templo Mayor (Plaza del Seminario)',
        guideBio: 'Egresado de la Universidad de Varsovia. Especialista en Historia de México, sus investigaciones destacan en religión, cosmovisión y arte.',
      },
    },
    category: 'tour',
  },
];

export const TOUR_GUIDE = TOURS[0].guide;