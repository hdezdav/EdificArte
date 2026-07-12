import type { APIRoute } from 'astro';
import { verifyMessage, getAddress } from 'viem';
import { getUserByWalletAddress, hashPassword, createSession, getUserBySession, type User } from '../../lib/auth';

/**
 * POST /api/wallet-login
 *
 * Verifica una firma EIP-191 (personal_sign) emitida por la wallet del
 * usuario, y crea / reutiliza la sesión correspondiente.
 *
 * Body: { address: string, nonce: string, signature: string }
 *
 * Respuesta: { ok: true, isNew: boolean }
 *
 * Flujo:
 *   1. Valida input.
 *   2. Recupera nonce guardado en KV por /api/wallet-nonce. Lo borra
 *      (one-time use). Si no existe → 401 "Nonce expirado o inválido".
 *   3. Verifica la firma con `viem.verifyMessage`. Si falla → 401.
 *   4. Busca user en `user_wallets` por address.
 *      - Existe → reutiliza (auto-login).
 *      - No existe → crea user nuevo + inserta en `user_wallets`.
 *        Maneja race condition (UNIQUE constraint en address) haciendo
 *        retry del lookup.
 *   5. Crea sesión con `createSession` (cookie httpOnly, 7 días TTL).
 */

function abbrevAddress(addr: string): string {
  // 0x1234567890abcdef1234567890abcdef12345678 → 0x1234…5678
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function createUserFromWallet(env: Env, address: string, phone: string | null): Promise<User> {
  // Email sintético único derivado de la address. No se puede usar para
  // login con password (password random), solo para identificar el user
  // en queries internas.
  const email = `${address.toLowerCase()}@wallet.edificarte.app`;
  const name = `Wallet ${abbrevAddress(address)}`;
  const randomPassword = crypto.randomUUID();
  const hashedPassword = await hashPassword(randomPassword);

  const userId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO users (id, email, password, name, avatar_url, bio, points, likes, visits, phone) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?)'
  )
    .bind(userId, email, hashedPassword, name, '👷', null, phone)
    .run();

  return {
    id: userId,
    email,
    name,
    avatar_url: '👷',
    bio: null,
    points: 0,
    likes: 0,
    visits: 0,
    phone,
    created_at: new Date().toISOString(),
  };
}

interface WalletLoginBody {
  address?: string;
  nonce?: string;
  signature?: string;
  phone?: string;
  guestBadges?: (string | number)[];
}

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const env = locals.runtime.env;

  // 1. Validar body.
  let body: WalletLoginBody;
  try {
    body = (await request.json()) as WalletLoginBody;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Body JSON inválido.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const rawAddress = (body.address ?? '').trim();
  const nonce = (body.nonce ?? '').trim();
  const signature = (body.signature ?? '').trim();

  if (!/^0x[0-9a-fA-F]{40}$/.test(rawAddress)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Address inválida.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (!/^[0-9a-fA-F]{32,}$/.test(nonce)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Nonce inválido.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    // Firma ECDSA secp256k1: 65 bytes = 130 hex chars + prefijo 0x.
    return new Response(
      JSON.stringify({ ok: false, error: 'Signature inválida.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const address = rawAddress.toLowerCase();

  // 2. Recuperar nonce de KV (one-time use).
  const nonceKey = `wallet-nonce:${address}`;
  let storedNonce: string;
  let issuedAt: string;
  try {
    const raw = await env.SESSION.get(nonceKey);
    if (!raw) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Nonce expirado o inválido. Solicitá uno nuevo.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    // Borrar inmediatamente para que no se pueda reusar.
    await env.SESSION.delete(nonceKey);

    const parsed = JSON.parse(raw) as { nonce?: string; issuedAt?: string };
    // Normalizar ambos a lowercase para comparación robusta.
    const storedNormalized = parsed.nonce?.toLowerCase() ?? '';
    const submittedNormalized = nonce.toLowerCase();
    if (!storedNormalized || storedNormalized !== submittedNormalized || !parsed.nonce) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Nonce no coincide.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    storedNonce = parsed.nonce;
    issuedAt = parsed.issuedAt ?? new Date().toISOString();
  } catch (err) {
    console.error('[api/wallet-login] KV error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: 'Error interno del servidor.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 3. Reconstruir el MISMO mensaje que el cliente firmó y verificar firma.
  // El cliente firma con el rawAddress que recibió en wallet-nonce (mixed
  // case EIP-55). Usamos la MISMA mixed-case acá para que el hash coincida.
  // Y pasamos la address también en EIP-55 a verifyMessage, porque viem
  // hace un checksum check interno que falla con address lowercase pura.
  let checksummedAddress: `0x${string}`;
  try {
    checksummedAddress = getAddress(address);
  } catch (err) {
    console.warn('[api/wallet-login] getAddress failed for', address, err);
    return new Response(
      JSON.stringify({ ok: false, error: 'Address inválida para verificación.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const message = [
    'Bienvenido a EdificARTE.',
    '',
    'Click "Sign" para iniciar sesión con tu wallet.',
    'Esta firma no gasta gas ni realiza transacciones.',
    '',
    `Address: ${rawAddress}`,
    `Nonce: ${storedNonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');

  let valid: boolean;
  try {
    valid = await verifyMessage({
      address: checksummedAddress,
      message,
      signature: signature as `0x${string}`,
    });
  } catch (err) {
    console.warn('[api/wallet-login] verifyMessage threw (likely malformed address or signature):', err);
    valid = false;
  }

  if (!valid) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Firma inválida. ¿La firmaste con la wallet correcta?' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 3b. Obtener el usuario autenticado actualmente por sesión (si existe)
  const loggedInUser = await getUserBySession(cookies, env);

  let user: User | null = null;
  let isNew = false;

  if (loggedInUser) {
    // Vincular la wallet a la cuenta de usuario existente
    const existingLink = await env.DB.prepare('SELECT user_id FROM user_wallets WHERE address = ?')
      .bind(address)
      .first<{ user_id: string }>();
    if (existingLink && existingLink.user_id !== loggedInUser.id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Esta wallet ya está vinculada a otra cuenta.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!existingLink) {
      await env.DB.prepare(
        'INSERT INTO user_wallets (user_id, address, chain_id) VALUES (?, ?, 137)'
      )
        .bind(loggedInUser.id, address)
        .run();
    }

    if (body.phone) {
      await env.DB.prepare('UPDATE users SET phone = ? WHERE id = ?')
        .bind(body.phone, loggedInUser.id)
        .run();
    }

    // Vincular insignias de guest si se pasaron
    if (body.guestBadges && Array.isArray(body.guestBadges)) {
      for (const badgeId of body.guestBadges) {
        const bId = Number(badgeId);
        if (!isNaN(bId)) {
          await env.DB.prepare(
            'INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)'
          )
            .bind(loggedInUser.id, bId)
            .run();
        }
      }
    }

    user = loggedInUser;
  } else {
    // 4. Buscar user existente por wallet.
    user = await getUserByWalletAddress(env, address);

    if (user) {
      if (body.phone) {
        await env.DB.prepare('UPDATE users SET phone = ? WHERE id = ?')
          .bind(body.phone, user.id)
          .run();
        user.phone = body.phone;
      }
      // Vincular insignias de guest si se pasaron
      if (body.guestBadges && Array.isArray(body.guestBadges)) {
        for (const badgeId of body.guestBadges) {
          const bId = Number(badgeId);
          if (!isNaN(bId)) {
            await env.DB.prepare(
              'INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)'
            )
              .bind(user.id, bId)
              .run();
          }
        }
      }
    } else {
      // 4a. Crear user nuevo + asociar wallet.
      try {
        const syntheticEmail = `${address.toLowerCase()}@wallet.edificarte.app`;
        const orphan = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
          .bind(syntheticEmail)
          .first<User>();

        let newUser: User;
        if (orphan) {
          newUser = orphan;
          if (body.phone) {
            await env.DB.prepare('UPDATE users SET phone = ? WHERE id = ?')
              .bind(body.phone, newUser.id)
              .run();
            newUser.phone = body.phone;
          }
        } else {
          newUser = await createUserFromWallet(env, address, body.phone || null);
        }

        try {
          await env.DB.prepare(
            'INSERT INTO user_wallets (user_id, address, chain_id) VALUES (?, ?, 137)'
          )
            .bind(newUser.id, address)
            .run();
          user = newUser;
          isNew = orphan === null;
        } catch (insertErr) {
          // Race condition
          const errMsg = insertErr instanceof Error ? insertErr.message : String(insertErr);
          console.warn('[api/wallet-login] wallet insert failed (retrying lookup):', errMsg);
          user = await getUserByWalletAddress(env, address);
          if (!user) {
            throw insertErr;
          }
        }

        // Vincular insignias de guest si se pasaron
        if (user && body.guestBadges && Array.isArray(body.guestBadges)) {
          for (const badgeId of body.guestBadges) {
            const bId = Number(badgeId);
            if (!isNaN(bId)) {
              await env.DB.prepare(
                'INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)'
              )
                .bind(user.id, bId)
                .run();
            }
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[api/wallet-login] create user error:', errMsg);
        const debugMsg = import.meta.env.PROD
          ? 'No pudimos crear tu cuenta. Intentá de nuevo.'
          : `No pudimos crear tu cuenta: ${errMsg}`;
        return new Response(
          JSON.stringify({ ok: false, error: debugMsg }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
  }

  // 5. Crear sesión.
  try {
    await createSession(cookies, env, user.id);
  } catch (err) {
    console.error('[api/wallet-login] createSession error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: 'Cuenta verificada pero no pudimos crear la sesión.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Limpiar cookie de guest si existía (UX: si venías como guest, ya no lo sos).
  cookies.delete('edificarte_guest', { path: '/' });
  cookies.delete('edificarte_guest_name', { path: '/' });

  return new Response(
    JSON.stringify({ ok: true, isNew, userId: user.id }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};