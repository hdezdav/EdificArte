import type { APIRoute } from 'astro';
import { MONUMENTS } from '../../data/monuments';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  const apiKey = env?.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('La variable de entorno GEMINI_API_KEY no está configurada.');
  }

  let messages: any[] = [];

  try {
    const body = await request.json();
    messages = body.messages;
    
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

    const systemInstruction = `Eres el Asistente de IA de EdificARTE, una audioguía y guía turística inteligente para la Ciudad de México (CDMX). Tu personalidad es entusiasta, culta y muy servicial.
IMPORTANTE:
1. Habla en español de México muy natural y cercano (tuteo respetuoso, NUNCA uses voseo argentino como "querés", "vení", "mirá"). Puedes usar palabras locales suaves como "hola qué tal", "aquí tienes", "chido", "padre".
2. Tus respuestas conversacionales deben ser sumamente breves y directas al grano (máximo de 2 o 3 oraciones muy cortas y concisas).
3. Si el usuario te pide una ruta, recomiéndale de 2 a 5 monumentos ordenados lógicamente y explícale brevemente que el mapa le trazará la ruta peatonal real para ir caminando por las calles.

Tienes acceso a los siguientes monumentos registrados en el sistema:
${monumentsContext}

Tu objetivo es responder las dudas del usuario.
Si el usuario te pide una ruta, recomendación de paseo o itinerario, selecciona entre 2 y 5 monumentos adecuados de la lista anterior, ordénalos en una secuencia lógica de visita, y pon sus IDs exactos en el campo 'route' del JSON de salida.
Si el usuario te pregunta por un solo monumento específico (ej: "¿Me cuentas de Bellas Artes?"), puedes incluir su ID como único elemento en el array 'route' (ej: ["bellas-artes"]).
Ejemplos de IDs válidos que puedes incluir en 'route': ${MONUMENTS.map(m => `"${m.id}"`).join(', ')}. Nunca inventes IDs que no estén en esta lista.
Si la pregunta del usuario es casual, un saludo, o no requiere trazar una ruta geográfica en el mapa, el campo 'route' debe ser un array vacío [].
SIEMPRE debes responder en formato JSON que cumpla exactamente con este esquema:
{
  "reply": "Tu respuesta conversacional corta mexicana con tips históricos y detalles de la ruta o monumento si aplica.",
  "route": ["id1", "id2", ...]
}`;

    // Construir los contents para la API de Gemini (formatear la historia de mensajes)
    // Nos interesa mantener los últimos mensajes para el contexto de chat
    const formattedContents = messages.slice(-6).map((msg: any) => ({
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

  } catch (err: any) {
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
        errorMessage: err.message
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
