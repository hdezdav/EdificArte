import type { APIRoute } from 'astro';

/**
 * GET /api/wallet-nonce?address=0x...
 *
 * Genera un nonce one-time y devuelve el mensaje canónico EIP-191 que el
 * cliente debe firmar con su wallet (MetaMask, Rabby, etc.) vía
 * `BrowserWalletProvider.signMessage(message)`.
 *
 * Flujo completo:
 *   1. Cliente pide GET /api/wallet-nonce?address=0x... → recibe {nonce, message}.
 *   2. Cliente firma el message con personal_sign (EIP-191).
 *   3. Cliente POST /api/wallet-login con {address, nonce, signature}.
 *
 * El nonce se guarda en KV con TTL 600s. Se borra al primer uso válido
 * (one-time use) por /api/wallet-login.
 *
 * Mensaje firmado es plain EIP-191 (NO SIWE completo EIP-4361) porque este
 * proyecto no usa ENS ni múltiples chains.
 */

const NONCE_TTL_SECONDS = 600; // 10 minutos

function buildSiweLikeMessage(address: string, nonce: string, issuedAt: string): string {
  // Texto legible para humanos. Incluye la address + nonce + timestamp para
  // que el usuario vea en MetaMask qué está firmando.
  return [
    'Bienvenido a EdificARTE.',
    '',
    'Click "Sign" para iniciar sesión con tu wallet.',
    'Esta firma no gasta gas ni realiza transacciones.',
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;

  // 1. Validar address formato.
  const rawAddress = (url.searchParams.get('address') ?? '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(rawAddress)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Address inválida.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  const address = rawAddress.toLowerCase();

  // 2. Generar nonce (32 bytes hex sin guiones).
  const nonce = crypto.randomUUID().replace(/-/g, '');

  // 3. Guardar nonce en KV con TTL.
  const issuedAt = new Date().toISOString();
  const stored = JSON.stringify({ nonce, issuedAt });
  try {
    await env.SESSION.put(`wallet-nonce:${address}`, stored, {
      expirationTtl: NONCE_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[api/wallet-nonce] KV put error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: 'Error interno del servidor.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 4. Devolver nonce + mensaje canónico a firmar.
  const message = buildSiweLikeMessage(rawAddress, nonce, issuedAt);

  return new Response(
    JSON.stringify({ ok: true, nonce, message, issuedAt }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};