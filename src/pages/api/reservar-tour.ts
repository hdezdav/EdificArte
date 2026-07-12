import type { APIRoute } from 'astro';
import { getUsdcVerifier } from '../../lib/onchain';

interface ReservationPayload {
  tourId: string;
  name: string;
  email: string;
  phone: string;
  date: string;
  people: number;
  notes?: string;
  txHash?: string;
  walletAddress?: string;
  totalUSDC?: number;
}

const TOURS_INFO: Record<string, { title: string; pricePerPerson: number }> = {
  'coyoacan-anahuacalli': { title: 'Recorrido 1: Centro Histórico de Coyoacán y Museo Anahuacalli', pricePerPerson: 480 },
  'san-angel-chimalistac': { title: 'Recorrido 2: San Ángel y Chimalistac', pricePerPerson: 480 },
  'xochimilco': { title: 'Recorrido 3: Xochimilco', pricePerPerson: 480 },
  'templo-mayor': { title: 'Recorrido Histórico: Templo Mayor y Centro Mexica', pricePerPerson: 480 },
};

const USDC_DECIMALS = 6;

function toRawUsdc(humanAmount: number): string {
  const [whole, dec = ''] = String(humanAmount).split('.');
  const decPadded = (dec + '0'.repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  const raw = BigInt(whole) * BigInt(10) ** BigInt(USDC_DECIMALS) + BigInt(decPadded || '0');
  return raw.toString();
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

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

    const totalMXN = tourInfo.pricePerPerson * body.people;
    let isPaid = false;

    // Si se intentó pagar con USDC, validar la tx en Polygon
    if (body.txHash && body.walletAddress && body.totalUSDC) {
      const paymentAddress = env.EDIFICARTE_PAYMENT_ADDRESS;
      if (!paymentAddress) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Pagos USDC no configurados en el servidor (EDIFICARTE_PAYMENT_ADDRESS).' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const expectedRawAmount = toRawUsdc(body.totalUSDC);
      let verifier;
      try {
        verifier = getUsdcVerifier(env);
      } catch (err) {
        console.error('[api/reservar-tour] No se pudo crear el verificador USDC:', err);
        return new Response(
          JSON.stringify({ ok: false, error: 'Error de configuración de pagos.' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const transfer = await verifier.verifyTransfer({
        txHash: body.txHash,
        expectedTo: paymentAddress,
        expectedAmount: expectedRawAmount,
      });

      if (!transfer) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'La transacción de pago no es válida. Verificá el monto, destino y que esté confirmada.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      isPaid = true;
    }

    // STUB: loguear la reserva
    console.log('[RESERVAR TOUR]', {
      timestamp: new Date().toISOString(),
      tour: tourInfo.title,
      tourId: body.tourId,
      customer: { name: body.name, email: body.email, phone: body.phone },
      date: body.date,
      people: body.people,
      totalMXN,
      notes: body.notes,
      isPaid,
      txHash: body.txHash,
      walletAddress: body.walletAddress,
      totalUSDC: body.totalUSDC
    });

    return new Response(
      JSON.stringify({
        ok: true,
        reservationId: `RES-${Date.now()}`,
        tour: tourInfo.title,
        totalMXN,
        status: isPaid ? 'paid' : 'pending',
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
