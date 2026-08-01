import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/admin';

export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime.env;

  if (!(isAdmin(locals))) {
    return new Response(JSON.stringify({ ok: false, error: 'No autenticado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const [usersCount, ordersCount, reviewsCount, revenueRow, recentUsers, recentOrders] =
      await Promise.all([
        env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>(),
        env.DB.prepare('SELECT COUNT(*) as count FROM orders').first<{ count: number }>(),
        env.DB.prepare('SELECT COUNT(*) as count FROM reviews').first<{ count: number }>(),
        env.DB.prepare('SELECT COALESCE(SUM(CAST(total_usdc AS REAL)), 0) as total FROM orders WHERE status = ?').bind('paid').first<{ total: number }>(),
        env.DB.prepare('SELECT id, name, email, points, visits, created_at FROM users ORDER BY created_at DESC LIMIT 10').all(),
        env.DB.prepare('SELECT id, wallet_address, total_usdc, status, created_at FROM orders ORDER BY created_at DESC LIMIT 10').all(),
      ]);

    return new Response(
      JSON.stringify({
        ok: true,
        stats: {
          totalUsers: usersCount?.count ?? 0,
          totalOrders: ordersCount?.count ?? 0,
          totalReviews: reviewsCount?.count ?? 0,
          totalRevenueUSDC: revenueRow?.total ?? 0,
        },
        recentUsers: recentUsers?.results ?? [],
        recentOrders: recentOrders?.results ?? [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[admin/stats]', err);
    return new Response(JSON.stringify({ ok: false, error: 'Error interno' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};