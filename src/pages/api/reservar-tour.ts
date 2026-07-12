import type { APIRoute } from 'astro';

interface ReservationPayload {
  tourId: string;
  name: string;
  email: string;
  phone: string;
  date: string;
  people: number;
  notes?: string;
}

const TOURS_INFO: Record<string, { title: string; pricePerPerson: number }> = {
  'coyoacan-anahuacalli': { title: 'Recorrido 1: Centro Histórico de Coyoacán y Museo Anahuacalli', pricePerPerson: 480 },
  'san-angel-chimalistac': { title: 'Recorrido 2: San Ángel y Chimalistac', pricePerPerson: 480 },
  'xochimilco': { title: 'Recorrido 3: Xochimilco', pricePerPerson: 480 },
  'templo-mayor': { title: 'Recorrido Histórico: Templo Mayor y Centro Mexica', pricePerPerson: 480 },
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as ReservationPayload;

    // Validación server-side
    if (
      !body.tourId ||
      !body.name ||
      !body.email ||
      !body.phone ||
      !body.date ||
      !body.people ||
      body.people < 1 ||
      body.people > 20
    ) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Faltan campos requeridos o son inválidos' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validar formato de email básico
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Email inválido' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const tourInfo = TOURS_INFO[body.tourId];
    if (!tourInfo) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Tour no encontrado' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const total = tourInfo.pricePerPerson * body.people;

    // STUB: loguear la reserva (futuro: enviar email + guardar en D1)
    console.log('[RESERVAR TOUR]', {
      timestamp: new Date().toISOString(),
      tour: tourInfo.title,
      tourId: body.tourId,
      customer: { name: body.name, email: body.email, phone: body.phone },
      date: body.date,
      people: body.people,
      totalMXN: total,
      notes: body.notes,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        reservationId: `RES-${Date.now()}`,
        tour: tourInfo.title,
        totalMXN: total,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Error procesando reserva:', err);
    return new Response(
      JSON.stringify({ ok: false, error: 'Error interno del servidor' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
