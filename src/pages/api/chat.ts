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
    const body = (await request.json()) as { messages?: unknown; userLocation?: { lat: number; lng: number } };
    const rawMessages = body.messages;

    if (!Array.isArray(rawMessages)) {
      return new Response(JSON.stringify({ error: 'Faltan los mensajes o el formato es incorrecto.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    messages = rawMessages as ChatMessage[];

    const userLocation = body.userLocation;

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
    if (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lng === 'number') {
      locationPromptAddition = `UBICACIÓN ACTUAL DEL USUARIO: Coordenadas [${userLocation.lat}, ${userLocation.lng}].
Recomienda monumentos indicando explícitamente la distancia (en metros) y calcula el tiempo a pie. IMPORTANTE: Si la distancia al destino o la ruta supera los 2500 metros (2.5 km), dile explícitamente al usuario que "por la distancia, es mejor ir en auto o transporte público". Si es menor, aconseja ir a pie e indica que la ruta en el mapa se trazará automáticamente.`;
    } else {
      locationPromptAddition = `UBICACIÓN ACTUAL DEL USUARIO: No disponible. Menciona que lo ideal para recorrer estas atracciones en el Centro Histórico es ir a pie, salvo que las distancias sean muy largas, en cuyo caso es mejor ir en auto.`;
    }

    const systemInstruction = `Eres el Agente Inteligente Oficial de EdificARTE, la plataforma interactiva de patrimonio, monumentos y cultura de la Ciudad de México (CDMX). Tu rol es ser un asistente conversacional inteligente que además PUEDE CONTROLAR acciones en la aplicación según lo que el usuario pida.

REGLAS DE PERSONALIDAD Y TONO:
- Habla en español mexicano natural, cálido, conversacional y muy servicial.
- Respuestas concisas: máximo 2-3 oraciones CORTAS. Directo al punto.

ACCIONES DISPONIBLES QUE PUEDES EJECUTAR ("action"):
1. "route": Si el usuario pide una ruta, paseo o recomendación de varios lugares (selecciona 2 a 5 IDs de monumentos) O si pide ver un monumento en particular (selecciona 1 ID).
2. "play_audio": Si el usuario quiere escuchar la audioguía, audio o historia narrada de un monumento (ej. "reproduce el audio de Bellas Artes"), pon su ID en "route" y "action": "play_audio".
3. "reserve": Si el usuario quiere hacer una reservación o agendar un tour/recorrido (ej. "quiero reservar una visita al Templo Mayor"), pon el ID del monumento en "route" y "action": "reserve".
4. "filter_category": Si el usuario pide filtrar o ver una categoría de lugares (ej. "muéstrame solo museos", "quiero ver plazas", "parques"), pon "action": "filter_category" y en "target" la categoría exacta ("Museo", "Plaza", "Cultura", "Religioso", "Parque", "Mirador").
5. "navigate": Si el usuario te pide ir a una sección o página de EdificArte, O SI PREGUNTA QUÉ COMPRAR, DÓNDE COMPRAR, SOUVENIRS O ARTESANÍAS, cuéntale entusiastamente sobre nuestra tienda (joyería del Mictlán, dulces típicos de amaranto y artesanías locales) y establece "action": "navigate" con "target": "/tienda". Si pide ir a otra sección (perfil/insignias, explorar, donar), usa su ruta correspondiente ("/mapa", "/explorar", "/yo", "/donar").
6. "chat": Para saludos o conversaciones informales sin acción específica, "route" es [] y "action": "chat".

MONUMENTOS DISPONIBLES EN EL CATÁLOGO OFICIAL:
${monumentsContext}

${locationPromptAddition}

REGLAS ESTRICTAS:
- NUNCA inventes IDs de monumentos que no estén en la lista anterior.
- Responde SIEMPRE en formato JSON estricto.

FORMATO DE RESPUESTA (JSON estricto):
{
  "reply": "Tu respuesta corta, entusiasta y amigable.",
  "route": ["id1", "id2"],
  "action": "chat",
  "target": "/explorar"
}`;

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

    return new Response(candidateText, {
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
