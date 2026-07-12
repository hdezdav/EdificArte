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
  type: 'museo' | 'templo' | 'arqueologia' | 'rascacielos' | 'sitio-remoto';
  image: string;
  // Opcionales para experiencias especiales:
  videoUrl?: string;       // VR / 360 video link
  isVRAvailable?: boolean; // Si tiene experiencia VR
  tourId?: string;         // ID de recorrido guiado adquirible
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
      'https://images.unsplash.com/photo-1604340923514-0a2b69fcc51f?q=80&w=1075&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
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
      'https://images.unsplash.com/photo-1610220260088-07fafc859f87?q=80&w=1074&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
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
      'https://content-historia.nationalgeographic.com.es/medio/2024/04/04/imagen-de-las-ruinas-del-templo-mayor-de-la-antigua-tenochtitlan-y-al-fondo-la-catedral-metropolitana-de-ciudad-de-mexico_513eb790_240404143954_1280x853.jpg',
    tourId: 'templo-mayor',
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
      'https://images.unsplash.com/photo-1564975930846-3da8c44284a5?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
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
      'https://plus.unsplash.com/premium_photo-1754211681560-19c9f3b9bb85?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
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
      'https://images.unsplash.com/photo-1611164589008-bf38fc66118c?q=80&w=1188&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
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
      'https://images.unsplash.com/photo-1682916114863-ba2f7b7d39c9?q=80&w=687&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
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
      'https://images.unsplash.com/photo-1693925369183-a815a771f7d5?q=80&w=735&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
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
      'https://mexicocity.cdmx.gob.mx/wp-content/uploads/2014/12/1024px-Plaza_de_las_3_cultruas_p3.jpg',
  },
  {
    id: 'piramides-sol',
    name: 'Pirámides del Sol',
    category: 'Zona Arqueológica · Teotihuacán',
    dist: '~50 km',
    lat: 19.6925,
    lng: -98.8438,
    emoji: '🔺',
    desc: 'La Pirámide del Sol es la estructura más grande de Teotihuacán, construida en el siglo I d.C. Mide 65 metros de altura y fue dedicada al dios sol. Recorré este sitio arqueológico en una experiencia inmersiva en realidad virtual.',
    audioDuration: '8:00',
    type: 'sitio-remoto',
    image: 'https://plus.unsplash.com/premium_photo-1697730030977-ea0505bd45ac?q=80&w=1171&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    videoUrl: 'https://www.youtube.com/embed/Wq9BpTOjE1E',
    isVRAvailable: true,
  },
  {
    id: 'hotel-virreyes',
    name: 'Hotel Virreyes',
    category: 'Hotel Boutique · Roma',
    dist: '~2 km',
    lat: 19.427015,
    lng: -99.141775,
    emoji: '🏨',
    desc: 'Hotel boutique ubicado en Avenida José María Izazaga 8, colonia Roma, alcaldía Cuauhtémoc, Ciudad de México. Un refugio de diseño contemporáneo que rinde homenaje a la historia y la cultura mexicana, con habitaciones temáticas inspiradas en los grandes artistas y arquitectos del país.',
    audioDuration: '3:30',
    type: 'museo',
    image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRVgXWGNBg6LC5gaZ1rmUXpQAGgDntOWI5TTClkJJirEquxSwry7wYM1pY&s=10',
  },
];
