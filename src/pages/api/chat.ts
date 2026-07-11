import type { APIRoute } from 'astro';
import { MONUMENTS } from '../../data/monuments';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  const apiKey = env?.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('La variable de entorno GEMINI_API_KEY no está configurada.');
  }

  try {
    const { messages } = await request.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Faltan los mensajes o el formato es incorrecto.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Preparar el contexto de monumentos
    const monumentsContext = MONUMENTS.map(m => 
      `- ID: "${m.id}", Nombre: "${m.name}", Categoría: "${m.category}", Tipo: "${m.type}", Descripción: "${m.desc}", Coordenadas: [${m.lat}, ${m.lng}]`
    ).join('\n');

    const systemInstruction = `Eres el Asistente AI de EdificARTE, una audioguía y guía turística inteligente para la Ciudad de México (CDMX). Tu personalidad es entusiasta, culta y muy amigable. Respondés en español Rioplatense natural (usá voseo: "querés", "vení", "mirá", "tumbas", "tenés", etc.), pero con conocimiento local de la CDMX.
Tenés acceso a los siguientes monumentos registrados en el sistema:
${monumentsContext}

Tu objetivo es responder las dudas del usuario. Si el usuario te pide una ruta, recomendación de paseo, o itinerario, elegí los monumentos más adecuados de la lista anterior y devolvé sus IDs ordenados en el campo 'route'.
Ejemplos de IDs válidos que podés incluir en 'route': ${MONUMENTS.map(m => `"${m.id}"`).join(', ')}.
Si la pregunta del usuario es casual o no requiere trazar una ruta geográfica en el mapa, el campo 'route' debe ser un array vacío [].
SIEMPRE debés responder en formato JSON que cumpla exactamente con este esquema:
{
  "reply": "Tu respuesta conversacional con tips históricos y detalles de la ruta si aplica.",
  "route": ["id1", "id2", ...]
}`;

    // Construir los contents para la API de Gemini (formatear la historia de mensajes)
    // Nos interesa mantener los últimos mensajes para el contexto de chat
    const formattedContents = messages.slice(-6).map((msg: any) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // Hacer la petición a la API de Gemini 1.5 Flash
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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

  } catch (err: any) {
    console.error('Error en /api/chat:', err);
    
    // Fallback amigable si la API falla o la key no es válida
    let fallbackReply = '¡Hola! Che, disculpame pero ando con algunos problemas de conexión en mi cerebro digital. ¿Te puedo ayudar con otra cosa?';
    
    // Si el usuario pidió una ruta, podemos hacer un fallback manual para simular el funcionamiento
    const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() || '';
    let fallbackRoute: string[] = [];
    
    if (lastMessage.includes('ruta') || lastMessage.includes('itinerario') || lastMessage.includes('paseo') || lastMessage.includes('museo')) {
      fallbackRoute = ['bellas-artes', 'catedral', 'templo-mayor'];
      fallbackReply = '¡Mirá! Como ando con un problemita de conexión, te armé una ruta de fallback rápida que arranca en el Palacio de Bellas Artes, pasa por la Catedral Metropolitana y termina en el Templo Mayor. ¡Disfrutá del recorrido!';
    }

    return new Response(
      JSON.stringify({
        reply: fallbackReply,
        route: fallbackRoute,
        isFallback: true,
        errorMessage: err.message
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
