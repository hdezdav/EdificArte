import type { APIRoute } from 'astro';
import { getUsdcVerifier } from '../../lib/onchain';

/**
 * POST /api/orders
 *
 * Registra una orden de compra de artesanías pagada en USDC de Polygon.
 *
 * Validación on-chain: el server verifica la tx (que el destino sea
 * EDIFICARTE_PAYMENT_ADDRESS, el monto coincida, sea USDC) antes de
 * persistir la orden. Esto evita que un cliente mande una tx fake.
 *
 * Body: {
 *   txHash: string,
 *   walletAddress: string,
 *   items: Array<{ sku: string, name: string, qty: number, priceMXN: number, priceUSDC: number }>,
 *   totalUSDC: number  (en formato humano, ej. 12.50 — server convierte a raw con 6 decimales)
 * }
 *
 * Respuesta: { ok: true, orderId, totalUSDC, txHash }
 */

interface OrderItem {
  sku?: string;
  name?: string;
  qty?: number;
  priceMXN?: number;
  priceUSDC?: number;
}

interface OrderPayload {
  txHash?: string;
  walletAddress?: string;
  items?: OrderItem[];
  totalUSDC?: number;
}

const USDC_DECIMALS = 6;

function toRawUsdc(humanAmount: number): string {
  // Convierte 12.50 → "12500000" (USDC tiene 6 decimales).
  // Usamos string math para evitar floats raros.
  const [whole, dec = ''] = String(humanAmount).split('.');
  const decPadded = (dec + '0'.repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  const raw = BigInt(whole) * BigInt(10) ** BigInt(USDC_DECIMALS) + BigInt(decPadded || '0');
  return raw.toString();
}

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const env = locals.runtime.env;

  let body: OrderPayload;
  try {
    body = (await request.json()) as OrderPayload;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Body JSON inválido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validación de campos
  const txHash = (body.txHash ?? '').trim();
  const walletAddress = (body.walletAddress ?? '').trim();
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'txHash inválido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'walletAddress inválido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return new Response(
      JSON.stringify({ ok: false, error: 'items requerido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  for (const item of body.items) {
    if (!item.sku || !item.name || !item.qty || item.qty < 1 || !item.priceUSDC) {
      return new Response(
        JSON.stringify({ ok: false, error: 'items mal formados' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }
  if (typeof body.totalUSDC !== 'number' || body.totalUSDC <= 0) {
    return new Response(
      JSON.stringify({ ok: false, error: 'totalUSDC inválido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const paymentAddress = env.EDIFICARTE_PAYMENT_ADDRESS;
  if (!paymentAddress) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Pagos USDC no configurados en el servidor (EDIFICARTE_PAYMENT_ADDRESS).' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const expectedRawAmount = toRawUsdc(body.totalUSDC);

  // Verificar la tx on-chain (o confiar en mock si no hay RPC configurado).
  let verifier;
  try {
    verifier = getUsdcVerifier(env);
  } catch (err) {
    console.error('[api/orders] No se pudo crear el verificador USDC:', err);
    return new Response(
      JSON.stringify({ ok: false, error: 'Error de configuración de pagos.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const transfer = await verifier.verifyTransfer({
    txHash,
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

  // Idempotencia: si ya existe una orden con este txHash, devolverla en vez
  // de crear un duplicado.
  const existing = await env.DB.prepare('SELECT id FROM orders WHERE tx_hash = ?')
    .bind(txHash)
    .first<{ id: string }>();
  if (existing) {
    return new Response(
      JSON.stringify({ ok: true, orderId: existing.id, alreadyExists: true, txHash }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Resolver user_id (si hay sesión activa; guest puede comprar igual)
  const session = cookies.get('edificarte_session')?.value;
  let userId: string | null = null;
  if (session) {
    const sessionDataStr = await env.SESSION.get(session);
    if (sessionDataStr) {
      try {
        const s = JSON.parse(sessionDataStr) as { userId: string };
        userId = s.userId;
      } catch {}
    }
  }

  const orderId = `ORD-${crypto.randomUUID()}`;
  const itemsJson = JSON.stringify(body.items);

  try {
    await env.DB.prepare(
      `INSERT INTO orders (id, user_id, wallet_address, tx_hash, total_usdc, items_json, status)
       VALUES (?, ?, ?, ?, ?, ?, 'paid')`
    )
      .bind(orderId, userId, walletAddress, txHash, expectedRawAmount, itemsJson)
      .run();
  } catch (err) {
    console.error('[api/orders] DB insert error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: 'No pudimos registrar la orden.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      orderId,
      totalUSDC: body.totalUSDC,
      txHash,
      // El verificador actual (`getUsdcVerifier`) siempre devuelve la
      // implementación Live; no hay path mock para pagos. Por eso el
      // campo es siempre 'verified' — la rama 'mock' quedó inalcanzable
      // y se removió del contrato de respuesta.
      mode: 'verified',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};