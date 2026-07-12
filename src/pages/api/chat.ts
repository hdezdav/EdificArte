import type { APIRoute } from 'astro';
import { MONUMENTS } from '../../data/monuments';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('La variable de entorno GEMINI_API_KEY no está configurada.');
  }

  let messages: ChatMessage[] = [];

  try {
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
Recomienda monumentos indicando explícitamente la distancia a pie (en metros) y calcula el tiempo que tardarán en llegar caminando (basado en los datos proveídos arriba). Aconseja ir a pie e indica que la ruta en el mapa se trazará automáticamente desde su ubicación actual hasta el primer destino.`;
    } else {
      locationPromptAddition = `UBICACIÓN ACTUAL DEL USUARIO: No disponible. Menciona que lo ideal para recorrer estas atracciones en el Centro Histórico es ir a pie.`;
    }

    const systemInstruction = `Eres el asistente de IA de EdificARTE, una audioguía turística inteligente para la Ciudad de México (CDMX).

REGLAS DE PERSONALIDAD:
- Habla en español mexicano natural y cálido (tuteo, nada de voseo).
- Respuestas conversacionales: máximo 2-3 oraciones CORTAS. Nada de párrafos largos.
- Puedes usar expresiones mexicanas suaves ("qué tal", "va que va", "padre", "chido").

MONUMENTOS DISPONIBLES EN EL SISTEMA:
${monumentsContext}

${locationPromptAddition}

CAPACIDAD DE RUTAS PEATONALES:
- El mapa usa OpenStreetMap + OSRM (Open Source Routing Machine) para trazar rutas peatonales REALES por calles y banquetas.
- Cuando generes una ruta, el sistema automáticamente calcula el camino a pie real entre cada punto.
- Ordena los monumentos geográficamente (de norte a sur, o en un circuito lógico por cercanía) para que la ruta peatonal sea eficiente.
- Todos los monumentos están en el Centro Histórico de la CDMX, a distancias caminables (máx ~2 km entre los más alejados).

REGLAS DE RESPUESTA:
1. Si el usuario pide ruta/paseo/itinerario: selecciona 2-5 monumentos, ordénalos en secuencia lógica caminable, ponlos en "route".
2. Si pregunta por un monumento específico: incluye solo su ID en "route".
3. Si es saludo o pregunta casual: "route" debe ser [].
4. IDs válidos: ${MONUMENTS.map(m => `"${m.id}"`).join(', ')}. NUNCA inventes IDs.

FORMATO DE RESPUESTA (JSON estricto):
{
  "reply": "Tu respuesta corta y amigable.",
  "route": ["id1", "id2"]
}`;

    // Construir los contents para la API de Gemini (formatear la historia de mensajes)
    // Nos interesa mantener los últimos mensajes para el contexto de chat
    const formattedContents = messages.slice(-6).map((msg: ChatMessage) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // Hacer la petición a la API de Gemini 3.5 Flash
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: formattedContents,
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                reply: { type: 'STRING' },
                route: {
                  type: 'ARRAY',
                  items: { type: 'STRING' }
                }
              },
              required: ['reply', 'route']
            }
          }
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API Error:', errText);
      throw new Error(`Gemini API respondió con estado ${response.status}`);
    }

    const data = await response.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      throw new Error('No se recibió texto de Gemini');
    }

    // Retornar la respuesta estructurada tal cual la entrega Gemini
    return new Response(candidateText, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });

  } catch (err: unknown) {
    console.error('Error en /api/chat:', err);
    
    // Fallback amigable si la API falla o la key no es válida
    let fallbackReply = '¡Hola! Qué tal. Ando con algunos problemas de conexión en mi cerebro digital. ¿Te puedo ayudar con otra cosa?';
    
    // Si el usuario pidió una ruta, podemos hacer un fallback manual para simular el funcionamiento
    const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() || '';
    let fallbackRoute: string[] = [];
    
    if (lastMessage.includes('ruta') || lastMessage.includes('itinerario') || lastMessage.includes('paseo') || lastMessage.includes('museo')) {
      fallbackRoute = ['bellas-artes', 'catedral', 'templo-mayor'];
      fallbackReply = '¡Hola! Como ando con un problemita de conexión, te armé una ruta rápida que arranca en el Palacio de Bellas Artes, pasa por la Catedral Metropolitana y termina en el Templo Mayor. ¡Disfruta el recorrido!';
    }

    return new Response(
      JSON.stringify({
        reply: fallbackReply,
        route: fallbackRoute,
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
