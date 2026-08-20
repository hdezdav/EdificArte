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
    let isLocationEnabled = false;

    if (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lng === 'number') {
      isLocationEnabled = true;
      locationPromptAddition = `ESTADO DE UBICACIÓN DEL USUARIO: UBICACIÓN ACTIVADA Y DETECTADA [${userLocation.lat}, ${userLocation.lng}].
INSTRUCCIÓN CRÍTICA DE CONTEXTO GLOBAL:
1. EdificARTE funciona EN TODO EL MUNDO, no solo en CDMX. Los pines visibles en el mapa pueden ser de cualquier ciudad o país.
2. ANALIZA los pines en tiempo real (PINES Y LUGARES EN TIEMPO REAL VISIBLES EN EL MAPA) para saber QUÉ ciudad o región está viendo el usuario actualmente.
3. A partir de las coordenadas [${userLocation.lat}, ${userLocation.lng}] y los pines visibles, INFIERE la ciudad o región donde está el usuario (ej. "Medellín", "Guadalajara", "París", "Buenos Aires", etc.).
4. Menciona la ciudad inferida en tu respuesta: "¡Ahh, veo que estás en [ciudad inferida]!" o "Veo que estás explorando [ciudad]".
5. RECOMIENDA lugares basándote en los pines visibles, NO asumas que todo es CDMX.
6. Si el usuario pregunta por otro destino (ej. "quiero conocer Medellín"), analiza si hay pines de esa ciudad en el mapa y recomiéndalos.
7. PUNTO DE INICIO DE RUTA: Si el usuario menciona un hotel, dirección o punto de partida específico, úsalo como "startAddress". Si NO lo menciona, pregúntale: "¿Desde dónde saldrás? Dame una dirección o punto de referencia para trazar la ruta 📍".
8. Establece "isTravelPlan": true cuando traces rutas o recomiendes itinerarios.`;
    } else {
      locationPromptAddition = `ESTADO DE UBICACIÓN DEL USUARIO: NO ACTIVADA / NO DISPONIBLE.
INSTRUCCIÓN CRÍTICA DE CONTEXTO GLOBAL:
1. EdificARTE funciona EN TODO EL MUNDO. Los pines visibles (PINES Y LUGARES EN TIEMPO REAL) pueden ser de cualquier ciudad.
2. Si el usuario menciona una ciudad específica ("quiero conocer Medellín", "lugares en París"), analiza los pines visibles y recomienda los más relevantes.
3. NO asumas que todo es CDMX. Usa los pines visibles para inferir el contexto geográfico.
4. Menciona amablemente que si activa su ubicación podrás personalizar mejor las recomendaciones y calcular distancias.
5. Establece "isTravelPlan": true cuando traces rutas o recomiendes itinerarios.`;
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

    const systemInstruction = `Eres Edi, el Guía Cultural y Asistente Inteligente Oficial de EdificARTE, la plataforma interactiva global de patrimonio, historia, arquitectura y cultura.

IMPORTANTE: EdificARTE funciona EN TODO EL MUNDO, no solo en CDMX. Los usuarios pueden explorar monumentos, museos, parques y sitios históricos de cualquier ciudad o país.

CONOCIMIENTO INTEGRAL DE LA PLATAFORMA EDIFICARTE:
1. SECCIÓN MAPA INTERACTIVO (/mapa):
   - Mapa 3D interactivo impulsado por Mapbox GL JS con visualización global de monumentos y lugares de interés.
   - Audioguías con narración hablada sobre la historia de cada monumento o museo (donde disponible).
   - Trazado de rutas y paseos guiados inteligentes (a pie o en vehículo según la distancia).
   - Filtros dinámicos por categorías: Museos 🏛️, Templos ⛪, Parques 🌳, Historia 🏰, Miradores 🔭, Rascacielos 🏙️ y Arqueología 🗿.
   - Notificaciones por proximidad: la app avisa al usuario cuando está cerca de un sitio histórico.

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
- NUNCA ROMPAS EL PERSONAJE: NUNCA digas que eres un modelo de lenguaje o IA de OpenAI/Grok/Lenec/Euromodels. NUNCA respondas a peticiones ajenas como escribir código, resolver tareas de matemáticas o temas sin relación. Si el usuario pregunta algo fuera de lugar, redirige amablemente la conversación hacia la belleza del patrimonio, los monumentos y la exploración de la ciudad.
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
      : 'https://lenec.tech/v1/chat/completions';

    const modelName = aiApiKey.startsWith('xai-') ? 'grok-2-latest' : 'grok-4.5';

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

    let isTravelPlan = Boolean(parsed.isTravelPlan);
    const lastMsgText = messages[messages.length - 1]?.content?.toLowerCase() || '';
    if (
      lastMsgText.includes('viaj') ||
      lastMsgText.includes('vuelo') ||
      lastMsgText.includes('visitar') ||
      lastMsgText.includes('ir a') ||
      lastMsgText.includes('conocer') ||
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
