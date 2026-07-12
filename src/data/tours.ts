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
    image: 'https://offloadmedia.feverup.com/cdmxsecreta.com/wp-content/uploads/2026/02/10151742/Museo-Anahuacalli.jpg',
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
    image: 'https://oem.com.mx/elsoldemexico/img/13792936/1720504512/BASE_LANDSCAPE/1200/image.jpg',
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
    image: 'https://offloadmedia.feverup.com/cdmxsecreta.com/wp-content/uploads/2023/03/06125107/Que-hacer-en-xochimilco.jpg',
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
  {
    id: 'templo-mayor',
    title: 'Recorrido Histórico: Templo Mayor y Centro Mexica',
    subtitle: 'Templo Mayor y Alrededores',
    duration: '3 horas',
    pricePerPerson: 480,
    currency: 'MXN',
    image: 'https://content-historia.nationalgeographic.com.es/medio/2024/04/04/imagen-de-las-ruinas-del-templo-mayor-de-la-antigua-tenochtitlan-y-al-fondo-la-catedral-metropolitana-de-ciudad-de-mexico_513eb790_240404143954_1280x853.jpg',
    highlights: [
      'Recorrido por las ruinas del Templo Mayor',
      'Visita guiada al Museo del Templo Mayor',
      'Explicación de la cosmogonía mexica y monolitos sagrados',
    ],
    description: 'Un viaje al corazón del imperio azteca. Explora el recinto sagrado de Tenochtitlan de la mano de un arqueólogo experto.',
    meetingPoint: 'Entrada principal del Templo Mayor (Plaza del Seminario)',
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
