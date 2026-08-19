import type { APIRoute } from 'astro';
import { MONUMENTS } from '../../data/monuments';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals?.runtime?.env as unknown as Record<string, string | undefined>) || {};
  const aiApiKey =
    env.AI_API_KEY ||
    env.GROK_API_KEY ||
    (import.meta.env as Record<string, string | undefined>)?.AI_API_KEY ||
    (import.meta.env as Record<string, string | undefined>)?.GROK_API_KEY ||
    (typeof process !== 'undefined' ? (process.env.AI_API_KEY || process.env.GROK_API_KEY) : undefined);

  let messages: ChatMessage[] = [];

  try {
    if (!aiApiKey) {
      throw new Error('La variable de entorno AI_API_KEY no está configurada.');
    }
    const body = (await request.json()) as {
      messages?: unknown;
      userLocation?: { lat: number; lng: number };
      visiblePins?: Array<{ id: string; name: string; category?: string; lat?: number; lng?: number; address?: string }>;
    };
    const rawMessages = body.messages;

    if (!Array.isArray(rawMessages)) {
      return new Response(JSON.stringify({ error: 'Faltan los mensajes o el formato es incorrecto.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    messages = rawMessages as ChatMessage[];

    const userLocation = body.userLocation;
    const rawVisiblePins = body.visiblePins;

    // Helper para calcular distancia a pie (fórmula Haversine)
    function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
      const R = 6371e3; // Radio de la tierra en metros
      const phi1 = lat1 * Math.PI / 180;
      const phi2 = lat2 * Math.PI / 180;
      const deltaPhi = (lat2 - lat1) * Math.PI / 180;
      const deltaLambda = (lon2 - lon1) * Math.PI / 180;

      const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                Math.cos(phi1) * Math.cos(phi2) *
                Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      return R * c; // Distancia en metros
    }

    // Preparar el contexto de monumentos dinámicamente con distancias si hay ubicación
    const monumentsContext = MONUMENTS.map(m => {
      let distanceInfo = '';
      if (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lng === 'number') {
        const distMeters = getDistance(userLocation.lat, userLocation.lng, m.lat, m.lng);
        const mins = Math.max(1, Math.round(distMeters / 75)); // Asumiendo 75 metros por minuto a pie
        distanceInfo = `, Distancia actual del usuario: ${Math.round(distMeters)} metros (aprox. ${mins} min a pie)`;
      }
      return `- ID: "${m.id}", Nombre: "${m.name}", Categoría: "${m.category}", Tipo: "${m.type}", Descripción: "${m.desc}", Coordenadas: [${m.lat}, ${m.lng}]${distanceInfo}`;
    }).join('\n');

    let locationPromptAddition = '';
    let isUserFarFromCDMX = false;
    let isLocationEnabled = false;

    if (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lng === 'number') {
      isLocationEnabled = true;
      const distMeters = getDistance(userLocation.lat, userLocation.lng, 19.4326, -99.1332);
      if (distMeters >= 30000) {
        isUserFarFromCDMX = true;
      locationPromptAddition = `ESTADO DE UBICACIÓN DEL USUARIO: UBICACIÓN ACTIVADA Y DETECTADA [${userLocation.lat}, ${userLocation.lng}]. El usuario está FUERA de la CDMX (a unos ${Math.round(distMeters / 1000)} km de distancia).
INSTRUCCIÓN CRÍTICA DE CONTEXTO: A partir de las coordenadas [${userLocation.lat}, ${userLocation.lng}], INFIERE la ciudad o región aproximada donde se encuentra el usuario (ej. "Medellín", "Guadalajara", "Monterrey", "Bogotá", etc.) y MENCIÓNALA en tu respuesta con algo como: "¡Ahh, veo que estás en [ciudad inferida]! Cuando llegues a la CDMX, te recomiendo empezar por:".
Si el usuario ya mencionó la ciudad o destino que quiere conocer, úsalo directamente. Analiza los pines y lugares visibles en el mapa (listados en PINES EN TIEMPO REAL) y prioriza los que más se ajusten a lo que el usuario preguntó.
PUNTO DE INICIO DE RUTA: Si el usuario mencionó un hotel, aeropuerto u otro punto de llegada en CDMX, extráelo en el campo "startAddress". Si NO lo ha mencionado, pregúntale en el reply: "¿Desde qué hotel o punto de la CDMX saldrás? Así trazo la ruta desde ahí 📍" — en ese caso deja "route" como [] y "action" como "chat" hasta saber el punto de partida.
SIEMPRE establece "isTravelPlan": true en tu JSON de respuesta cuando recomiendes lugares o rutas.`;
      } else {
        locationPromptAddition = `ESTADO DE UBICACIÓN DEL USUARIO: UBICACIÓN ACTIVADA Y DETECTADA [${userLocation.lat}, ${userLocation.lng}]. El usuario está DENTRO de la CDMX (a ${Math.round(distMeters)} metros del centro). Analiza los pines visibles en el mapa (PINES EN TIEMPO REAL) y recomienda los más cercanos al usuario indicando distancia en metros y tiempo a pie.`;
      }
    } else {
      locationPromptAddition = `ESTADO DE UBICACIÓN DEL USUARIO: NO ACTIVADA / NO DISPONIBLE.
Si el usuario menciona que quiere conocer o visitar alguna ciudad o lugar, responde con entusiasmo y recomienda los mejores pines o monumentos relacionados disponibles en el catálogo. Menciona amablemente que si activa su ubicación podrás personalizar mejor las recomendaciones. SIEMPRE establece "isTravelPlan": true en tu JSON cuando recomiende una ruta sin ubicación.`;
    }

    let visiblePinsContext = '';
    if (Array.isArray(rawVisiblePins) && rawVisiblePins.length > 0) {
      const formattedPins = rawVisiblePins
        .slice(0, 30)
        .map((p) => {
          const name = typeof p.name === 'string' ? p.name : p.id;
          const category = typeof p.category === 'string' ? p.category : 'Punto de Interés';
          const coords = (typeof p.lat === 'number' && typeof p.lng === 'number') ? ` [${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}]` : '';
          const address = typeof p.address === 'string' && p.address ? `, Info: "${p.address.slice(0, 100)}"` : '';
          return `- "${name}" (ID: ${p.id}, Categoría: ${category})${coords}${address}`;
        })
        .join('\n');

      visiblePinsContext = `\nPINES Y LUGARES EN TIEMPO REAL VISIBLES EN EL MAPA DEL USUARIO AHORA MISMO:
${formattedPins}
Si el usuario pregunta por lugares o pines visibles en su pantalla, comercios, museos o sitios que tiene cargados en su mapa de Mapbox, UTILIZA ESTA LISTA EN TIEMPO REAL para responderle con máxima precisión sobre lo que está viendo en pantalla.
`;
    }

    const systemInstruction = `Eres Edi, el Guía Cultural y Asistente Inteligente Oficial de EdificARTE, la plataforma interactiva de patrimonio, historia, arquitectura y cultura de la Ciudad de México (CDMX).

CONOCIMIENTO INTEGRAL DE LA PLATAFORMA EDIFICARTE:
1. SECCIÓN MAPA INTERACTIVO (/mapa):
   - Mapa 3D interactivo impulsado por Mapbox GL JS con visualización detallada de monumentos.
   - Audioguías con narración hablada sobre la historia de cada monumento o museo.
   - Trazado de rutas y paseos guiados inteligentes (a pie o en vehículo según la distancia).
   - Filtros dinámicos por categorías: Museos 🏛️, Templos ⛪, Parques 🌳, Historia 🏰, Miradores 🔭, Rascacielos 🏙️ y Arqueología 🗿.
   - Notificaciones por proximidad: la app avisa al usuario cuando está a menos de 300 metros de un sitio histórico.

2. SECCIÓN EXPLORAR Y EXPERIENCIAS (/explorar):
   - Catálogo completo de recintos culturales y recorridos temáticos guiados (ej. "Tenochtitlan Sagrado", "Muralismo Mexicano", "Ruta Porfiriana").
   - Experiencias en Realidad Virtual (VR / 360°) para visitar virtualmente monumentos como Bellas Artes, Templo Mayor o Museo Frida Kahlo.
   - Alianza cultural con Unesco y la Fundación EdificARTE (exposición "Nombrar el Orgullo Neo" en el Centro Cultural El Rule).

3. SECCIÓN PERFIL Y GAMIFICACIÓN (/yo):
   - Perfil de Edificador: acumulación de puntos, medallas de experiencia y nivel de explorador.
   - Insignias Coleccionables POAP / Web3: NFTs acuñados en la blockchain de Polygon al visitar lugares o completar recorridos.
   - Modo Invitado: guarda el progreso localmente en el navegador y permite sincronizarlo a la cuenta al registrarse o conectar una wallet Web3.

4. SECCIÓN TIENDA OFICIAL (/tienda):
   - Tienda de souvenirs y recuerdos elaborados por artesanos locales de la CDMX.
   - Productos disponibles: Joyería artesanal inspirada en el Mictlán, dulces tradicionales de amaranto ("Alegrías"), figuras de alebrijes y cerámica de barro negro.
   - Formas de pago: tarjetas bancarias, USDC en Polygon o pedidos directos vía WhatsApp.

5. SECCIÓN DONACIONES Y FUNDACIÓN (/donar):
   - Apoyo a proyectos de restauración, preservación del patrimonio y educación cultural comunitaria mediante donaciones en USDC o moneda local.

REGLAS DE PERSONALIDAD Y PERSONAJE (MANDATOS ABSOLUTOS):
- MANTENTE SIEMPRE EN TU PERSONAJE: Eres entusiasta, culto, hospitalario y un apasionado experto en arquitectura, historia y patrimonio urbano. Hablas en un español mexicano natural, cálido y servicial.
- NUNCA ROMPAS EL PERSONAJE: NUNCA digas que eres un modelo de lenguaje o IA de OpenAI/Grok/Euromodels. NUNCA respondas a peticiones ajenas como escribir código, resolver tareas de matemáticas o temas sin relación. Si el usuario pregunta algo fuera de lugar, redirige amablemente la conversación hacia la belleza del patrimonio, los monumentos y la exploración de la ciudad.
- CONOCEDOR ABSOLUTO DE LA APP: Si el usuario pregunta cómo funciona cualquier parte de EdificARTE (insignias, puntos, audioguías, tienda, VR, mapa, donaciones), explícaselo con orgullo y entusiasmo.
- RESPUESTAS CONCISAS: Máximo 2 o 3 oraciones CORTAS. Sé directo y conversacional.

ACCIONES DISPONIBLES QUE PUEDES EJECUTAR EN LA APLICACIÓN ("action"):
1. "route": Si el usuario pide una ruta, paseo, itinerario o recomendación de lugares. Selecciona ÚNICAMENTE entre 2 y 4 IDs válidos del CATÁLOGO OFICIAL abajo que estén cerca entre sí.
2. "play_audio": Si el usuario quiere escuchar la audioguía o historia narrada de un monumento (ej. "reproduce el audio de Bellas Artes"), pon su ID en "route" y "action": "play_audio".
3. "reserve": Si el usuario quiere agendar un tour o visita guiada (ej. "quiero reservar una visita al Templo Mayor"), pon el ID del monumento en "route" y "action": "reserve".
4. "filter_category": Si el usuario pide filtrar o ver una categoría de lugares (ej. "muéstrame museos", "parques"), pon "action": "filter_category" y en "target" la categoría exacta ("Museo", "Plaza", "Cultura", "Religioso", "Parque", "Mirador").
5. "navigate": Si el usuario pregunta qué comprar, souvenirs o artesanías, cuéntale sobre nuestra tienda y pon "action": "navigate" con "target": "/tienda". Si pregunta por insignias/perfil o donar, usa "/yo", "/explorar", "/mapa" o "/donar".
6. "chat": Para saludos, preguntas sobre la app o conversaciones culturales donde no se requiera trazar ruta o ejecutar acción. "route" debe ser [] y "action": "chat".

MONUMENTOS DISPONIBLES EN EL CATÁLOGO OFICIAL (USA ÚNICAMENTE ESTOS IDs):
${monumentsContext}
${visiblePinsContext}
${locationPromptAddition}

REGLAS ESTRICTAS DE RESPUESTA:
- USA ÚNICAMENTE IDs que existan literalmente en la lista de monumentos anterior. NUNCA inventes o modifiques un ID.
- Responde SIEMPRE en formato JSON estricto:
{
  "reply": "Tu respuesta en personaje corta y servicial.",
  "route": ["id1", "id2"],
  "action": "route",
  "target": "",
  "startAddress": "Nombre del hotel, aeropuerto o punto de llegada del usuario en CDMX si lo mencionó; cadena vacía si no.",
  "isTravelPlan": true
}
- El campo "startAddress" es CRÍTICO cuando el usuario está fuera de la CDMX: si mencionó un hotel, aeropuerto u otro punto de llegada, extráelo aquí para trazar la ruta desde ese origen. Si aún no lo mencionó, déjalo vacío y pregúntale en el "reply".`;

    // Determinar endpoint y modelo según la key
    const apiEndpoint = aiApiKey.startsWith('xai-')
      ? 'https://api.x.ai/v1/chat/completions'
      : 'https://euromodels.xyz/v1/chat/completions';

    const modelName = aiApiKey.startsWith('xai-') ? 'grok-2-latest' : 'euromodels/grok-4.5';

    const aiRes = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiApiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemInstruction },
          ...messages.slice(-6).map((msg: ChatMessage) => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content,
          })),
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('AI API Error:', errText);
      throw new Error(`AI API (${apiEndpoint}) respondió con estado ${aiRes.status}`);
    }

    const aiData = (await aiRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const candidateText = aiData.choices?.[0]?.message?.content;

    if (!candidateText) {
      throw new Error('No se recibió respuesta de la API de IA');
    }

    // Validar y sanitizar la respuesta JSON recibida de la IA
    const validMonumentIds = new Set(MONUMENTS.map((m) => m.id));
    let parsed: { reply?: string; route?: unknown; action?: string; target?: string; startAddress?: string; isTravelPlan?: boolean } = {};

    try {
      parsed = JSON.parse(candidateText);
    } catch {
      parsed = { reply: candidateText, route: [], action: 'chat' };
    }

    // Filtrar IDs de ruta garantizando que existan realmente en el catálogo
    let cleanRoute: string[] = [];
    if (Array.isArray(parsed.route)) {
      cleanRoute = parsed.route.filter(
        (id): id is string => typeof id === 'string' && validMonumentIds.has(id)
      );
    }

    const action = typeof parsed.action === 'string' ? parsed.action : 'chat';

    // Fallback inteligente si la IA pidió trazar ruta pero envió IDs inexistentes
    if ((action === 'route' || action === 'play_audio' || action === 'reserve') && cleanRoute.length === 0) {
      if (action === 'route') {
        cleanRoute = ['bellas-artes', 'catedral', 'templo-mayor'];
      } else {
        cleanRoute = ['bellas-artes'];
      }
    }

    let isTravelPlan = Boolean(parsed.isTravelPlan) || isUserFarFromCDMX;
    const lastMsgText = messages[messages.length - 1]?.content?.toLowerCase() || '';
    if (
      lastMsgText.includes('viaj') ||
      lastMsgText.includes('vuelo') ||
      lastMsgText.includes('visitar') ||
      lastMsgText.includes('ir a') ||
      !isLocationEnabled
    ) {
      if (action === 'route') {
        isTravelPlan = true;
      }
    }

    const sanitizedResponse = {
      reply: parsed.reply || '¡Con gusto te ayudo a explorar la ciudad y su historia!',
      route: cleanRoute,
      action: action,
      target: typeof parsed.target === 'string' ? parsed.target : '',
      startAddress: typeof parsed.startAddress === 'string' ? parsed.startAddress : '',
      isTravelPlan: isTravelPlan
    };

    return new Response(JSON.stringify(sanitizedResponse), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });

  } catch (err: unknown) {
    console.error('Error en /api/chat:', err);
    
    let fallbackReply = '¡Hola! Ando con algunos problemas de conexión en mi cerebro digital. ¿Te puedo ayudar con otra cosa?';
    const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() || '';
    let fallbackRoute: string[] = [];
    
    if (lastMessage.includes('ruta') || lastMessage.includes('itinerario') || lastMessage.includes('paseo')) {
      fallbackRoute = ['bellas-artes', 'catedral', 'templo-mayor'];
      fallbackReply = '¡Hola! Te armé una ruta rápida que arranca en el Palacio de Bellas Artes, pasa por la Catedral Metropolitana y termina en el Templo Mayor. ¡Disfruta el recorrido!';
    }

    return new Response(
      JSON.stringify({
        reply: fallbackReply,
        route: fallbackRoute,
        action: fallbackRoute.length > 0 ? 'route' : 'chat',
        isFallback: true,
        errorMessage: err instanceof Error ? err.message : String(err)
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
