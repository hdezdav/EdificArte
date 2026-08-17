import type { APIRoute } from 'astro';
import { MONUMENTS } from '../../data/monuments';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals?.runtime?.env || {};
  const grokApiKey = env.GROK_API_KEY;
  const geminiApiKey = env.GEMINI_API_KEY;

  let messages: ChatMessage[] = [];

  try {
    if (!grokApiKey && !geminiApiKey) {
      throw new Error('La variable de entorno GROK_API_KEY (o GEMINI_API_KEY) no está configurada.');
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

    const systemInstruction = `Eres el asistente de IA de EdificARTE, una guía interactiva inteligente para el patrimonio y cultura de la Ciudad de México (CDMX).

REGLAS DE PERSONALIDAD:
- Habla en español mexicano natural y cálido (tuteo, nada de voseo).
- Respuestas conversacionales: máximo 2-3 oraciones CORTAS. Nada de párrafos largos.

REGLA ESTRICTA DE RECOMENDACIONES:
- SOLO puedes recomendar y hablar sobre los monumentos y servicios que ofrecemos en nuestra página (listados abajo). Si el usuario pide recomendaciones de lugares, restaurantes o atracciones que no están en la lista, dile amablemente que por ahora solo cubres los lugares de tu catálogo oficial de EdificARTE.

MONUMENTOS DISPONIBLES EN EL SISTEMA:
${monumentsContext}

${locationPromptAddition}

CAPACIDAD DE RUTAS Y RESERVACIONES:
- Si el usuario pide ruta/paseo/itinerario: selecciona 2-5 monumentos, ponlos en "route" y establece "action": "route".
- Si pregunta por un monumento específico: incluye solo su ID en "route" y establece "action": "route".
- Si el usuario quiere hacer una RESERVACIÓN (o agendar un tour/recorrido) para un lugar: responde que con gusto le abres la pestaña de reservación, pon el ID del monumento (solo uno) en "route" y establece "action": "reserve".
- Si es saludo o pregunta casual: "route" debe ser [] y "action": "chat".
- NUNCA inventes IDs.

FORMATO DE RESPUESTA (JSON estricto):
{
  "reply": "Tu respuesta corta y amigable.",
  "route": ["id1", "id2"],
  "action": "chat"
}`;

    let candidateText: string | undefined;

    if (grokApiKey) {
      // Petición a la API de Grok (xAI) - Formato OpenAI compatible
      const grokRes = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${grokApiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-2-latest',
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

      if (!grokRes.ok) {
        const errText = await grokRes.text();
        console.error('Grok API Error:', errText);
        throw new Error(`Grok API respondió con estado ${grokRes.status}`);
      }

      const grokData = (await grokRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
      candidateText = grokData.choices?.[0]?.message?.content;
    } else if (geminiApiKey) {
      // Fallback a Gemini API
      const formattedContents = messages.slice(-6).map((msg: ChatMessage) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      const geminiRes = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': geminiApiKey,
          },
          body: JSON.stringify({
            contents: formattedContents,
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  reply: { type: 'STRING' },
                  route: { type: 'ARRAY', items: { type: 'STRING' } },
                  action: { type: 'STRING', enum: ['chat', 'route', 'reserve'] },
                },
                required: ['reply', 'route', 'action'],
              },
            },
          }),
        }
      );

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        console.error('Gemini API Error:', errText);
        throw new Error(`Gemini API respondió con estado ${geminiRes.status}`);
      }

      const geminiData = (await geminiRes.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      candidateText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    }

    if (!candidateText) {
      throw new Error('No se recibió respuesta válida del proveedor de IA');
    }

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
    
    if (lastMessage.includes('ruta') || lastMessage.includes('itinerario') || lastMessage.includes('paseo')) {
      fallbackRoute = ['bellas-artes', 'catedral', 'templo-mayor'];
      fallbackReply = '¡Hola! Como ando con un problemita de conexión, te armé una ruta rápida que arranca en el Palacio de Bellas Artes, pasa por la Catedral Metropolitana y termina en el Templo Mayor. ¡Disfruta el recorrido!';
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
