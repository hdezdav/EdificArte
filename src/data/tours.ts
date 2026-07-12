export interface Tour {
  id: string;
  title: string;
  subtitle: string;
  // duración estimada del recorrido (ej "4-5 horas")
  duration: string;
  pricePerPerson: number;
  currency: 'MXN';
  image: string;
  // lugares / puntos que se visitan en el tour
  highlights: string[];
  // descripción corta del recorrido
  description: string;
  meetingPoint: string;
  guide: {
    name: string;
    title: string;
    bio: string;
  };
  category: 'tour';
}

export const TOURS: Tour[] = [
  {
    id: 'coyoacan-anahuacalli',
    title: 'Recorrido 1: Centro Histórico de Coyoacán y Museo Anahuacalli',
    subtitle: 'Coyoacán y Museo Anahuacalli',
    duration: '4-5 horas',
    pricePerPerson: 480,
    currency: 'MXN',
    image: 'https://images.unsplash.com/photo-1518105779142-d975f22f1b0a?q=80&w=1200&auto=format&fit=crop',
    highlights: [
      'Entrada por Francisco Sosa, la calle más bella de Coyoacán',
      'Jardín Centenario',
      'Ex convento Dominico y parroquia de San Juan Bautista',
      'Capilla de la Conchita',
      'Museo Frida Kahlo (La Casa Azul)',
      'Museo Anahuacalli',
    ],
    description: 'Recorrido por el corazón histórico de Coyoacán, desde la calle más emblemática hasta la pirámide de basalto diseñada por Diego Rivera para resguardar su colección de arte prehispánico.',
    meetingPoint: 'Plaza de la Conchita, Coyoacán',
    guide: {
      name: 'Mtro. Henryk Karol Kocyba',
      title: 'Antropólogo y arqueólogo',
      bio: 'Egresado de la Universidad de Varsovia. Especialista en Historia de México, sus investigaciones destacan en religión, cosmovisión y arte.',
    },
    category: 'tour',
  },
  {
    id: 'san-angel-chimalistac',
    title: 'Recorrido 2: San Ángel y Chimalistac',
    subtitle: 'San Ángel y Chimalistac',
    duration: '4 horas',
    pricePerPerson: 480,
    currency: 'MXN',
    image: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?q=80&w=1200&auto=format&fit=crop',
    highlights: [
      'Ex convento del Carmen',
      'Plaza de San Jacinto con la Casa del Risco (Centro Cultural Isidro Fabela)',
      'Templo y ex convento de San Jacinto',
      'Parroquia de San Sebastián Mártir en Chimalistac',
      'Mercado de flores "Melchor Múzquiz"',
    ],
    description: 'Recorrido por los barrios coloniales más bellos del sur de la CDMX, sus ex conventos del siglo XVII y el famoso mercado de flores.',
    meetingPoint: 'Ex convento del Carmen, San Ángel',
    guide: {
      name: 'Mtro. Henryk Karol Kocyba',
      title: 'Antropólogo y arqueólogo',
      bio: 'Egresado de la Universidad de Varsovia. Especialista en Historia de México, sus investigaciones destacan en religión, cosmovisión y arte.',
    },
    category: 'tour',
  },
  {
    id: 'xochimilco',
    title: 'Recorrido 3: Xochimilco',
    subtitle: 'Chinampas de Xochimilco',
    duration: '3-4 horas',
    pricePerPerson: 480,
    currency: 'MXN',
    image: 'https://images.unsplash.com/photo-1584285405439e5755cd8?auto=format&fit=crop&w=1200&q=80',
    highlights: [
      'Recorrido por las chinampas de Xochimilco (Patrimonio Cultural de la Humanidad)',
      'Técnicas prehispánicas de cultivo',
      'Cómo se construyó una ciudad y sus cultivos que flotan en el agua',
    ],
    description: 'Recorrido por el sistema de chinampas prehispánico de Xochimilco, declarado Patrimonio Cultural de la Humanidad. Aprendé cómo los mexicas construyeron una ciudad agrícola sobre el agua. El servicio de trajineras es independiente (paradero Cuemanco).',
    meetingPoint: 'Paradero Cuemanco, Xochimilco',
    guide: {
      name: 'Mtro. Henryk Karol Kocyba',
      title: 'Antropólogo y arqueólogo',
      bio: 'Egresado de la Universidad de Varsovia. Especialista en Historia de México, sus investigaciones destacan en religión, cosmovisión y arte.',
    },
    category: 'tour',
  },
];

// El guía es el mismo para los 3 tours
export const TOUR_GUIDE = TOURS[0].guide;
