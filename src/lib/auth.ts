import type { AstroCookies } from 'astro';

const PASSWORD_SALT = "edificarte-app-salt-2026";

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + PASSWORD_SALT);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  bio: string | null;
  points: number;
  likes: number;
  visits: number;
  created_at: string;
}

export async function getUserBySession(
  cookies: AstroCookies,
  env: Env
): Promise<User | null> {
  const sessionId = cookies.get('edificarte_session')?.value;
  if (!sessionId) return null;

  try {
    const sessionDataStr = await env.SESSION.get(sessionId);
    if (!sessionDataStr) return null;

    const session = JSON.parse(sessionDataStr) as { userId: string };
    if (!session.userId) return null;

    const { results } = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(session.userId)
      .all<User>();

    return results[0] || null;
  } catch (err) {
    console.error('Error fetching user by session:', err);
    return null;
  }
}

export async function createSession(
  cookies: AstroCookies,
  env: Env,
  userId: string
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const sessionData = JSON.stringify({ userId });
  
  // Guardamos la sesión en KV con expiración de 7 días (604800 segundos)
  await env.SESSION.put(sessionId, sessionData, { expirationTtl: 604800 });

  cookies.set('edificarte_session', sessionId, {
    path: '/',
    httpOnly: true,
    // secure: true en dev (http://localhost) hace que el navegador rechace
    // la cookie silenciosamente. Solo marcar secure en producción.
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7 // 1 semana
  });

  return sessionId;
}

export async function deleteSession(cookies: AstroCookies, env: Env): Promise<void> {
  const sessionId = cookies.get('edificarte_session')?.value;
  if (sessionId) {
    await env.SESSION.delete(sessionId);
  }
  cookies.delete('edificarte_session', { path: '/' });
}

export async function getUserBadges(env: Env, userId: string): Promise<number[]> {
  try {
    const { results } = await env.DB.prepare(
      'SELECT badge_id FROM user_badges WHERE user_id = ?'
    )
      .bind(userId)
      .all();
    return results.map((r: { badge_id: number }) => r.badge_id);
  } catch (err) {
    console.error('Error fetching user badges:', err);
    return [];
  }
}

export async function unlockUserBadge(
  env: Env,
  userId: string,
  badgeId: number
): Promise<boolean> {
  try {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)'
    )
      .bind(userId, badgeId)
      .run();
    return true;
  } catch (err) {
    console.error('Error unlocking badge:', err);
    return false;
  }
}

/**
 * Suma puntos a un usuario y devuelve los puntos totales actualizados.
 * Usado por /api/reviews (5 puntos) y /api/orders (potencialmente).
 */
export async function addPoints(
  env: Env,
  userId: string,
  points: number
): Promise<number> {
  try {
    await env.DB.prepare(
      'UPDATE users SET points = points + ? WHERE id = ?'
    )
      .bind(points, userId)
      .run();
    const row = await env.DB.prepare(
      'SELECT points FROM users WHERE id = ?'
    )
      .bind(userId)
      .first<{ points: number }>();
    return row?.points ?? 0;
  } catch (err) {
    console.error('Error adding points:', err);
    return 0;
  }
}
