import { describe, expect, it, vi } from 'vitest';
import {
  resolveAdminRequestContext,
  validateCsrf,
  validateSameOrigin,
} from '../src/lib/admin';
import { POST as login } from '../src/pages/api/admin/login';
import { POST as logout } from '../src/pages/api/admin/logout';

const mockSessions = new Map<string, string>();
const mockKVSession = {
  get: async (key: string) => mockSessions.get(key) || null,
  put: async (key: string, val: string) => { mockSessions.set(key, val); },
  delete: async (key: string) => { mockSessions.delete(key); },
};

const mockEnv = {
  SESSION: mockKVSession,
  DB: {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
    }),
  },
  ADMIN_PASSWORD_HASH: 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f', // hash of admin123
} as unknown as Env;

describe('Cloudflare admin identity', () => {
  it('verifies admin access with KV session', async () => {
    mockSessions.set('admin_session_valid-session-1', JSON.stringify({ userId: 'admin-1', role: 'admin', email: 'admin@turimap.app' }));

    const jar = new Map<string, string>([['turimap_admin_session', 'valid-session-1']]);
    const cookies = {
      get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
      set: (name: string, value: string) => jar.set(name, value),
      delete: (name: string) => jar.delete(name),
    };

    const res = await resolveAdminRequestContext(mockEnv, cookies as never, true);
    expect(res.authorized).toBe(true);
    expect(res.user?.email).toBe('admin@turimap.app');
  });

  it('denies access with invalid session token', async () => {
    const jar = new Map<string, string>([['turimap_admin_session', 'invalid-session']]);
    const cookies = {
      get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
      set: (name: string, value: string) => jar.set(name, value),
      delete: (name: string) => jar.delete(name),
    };

    const res = await resolveAdminRequestContext(mockEnv, cookies as never, true);
    expect(res.authorized).toBe(false);
  });
});

describe('admin mutation defenses', () => {
  it('requires a same-origin Origin and Host', () => {
    expect(
      validateSameOrigin(
        new Request('https://app.test', {
          headers: { origin: 'https://app.test', host: 'app.test' },
        })
      )
    ).toBe(true);
    expect(
      validateSameOrigin(
        new Request('https://app.test', {
          headers: { origin: 'https://evil.test', host: 'app.test' },
        })
      )
    ).toBe(false);
  });

  it('requires the session-bound CSRF value', () => {
    expect(validateCsrf(new Request('https://app.test'), 'token')).toBe(false);
    expect(
      validateCsrf(
        new Request('https://app.test', {
          headers: { 'x-csrf-token': 'wrong' },
        }),
        'token'
      )
    ).toBe(false);
    expect(
      validateCsrf(
        new Request('https://app.test', {
          headers: { 'x-csrf-token': 'token' },
        }),
        'token'
      )
    ).toBe(true);
  });
});

describe('login endpoint', () => {
  it('validates admin credentials and creates KV session', async () => {
    const cookiesSet = vi.fn();
    const response = await login({
      request: new Request('https://app.test/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'admin@turimap.app',
          password: 'admin',
        }),
      }),
      cookies: { set: cookiesSet },
      locals: {
        runtime: { env: mockEnv },
      },
    } as never);

    expect(response.status).toBe(200);
    expect(cookiesSet).toHaveBeenCalledWith('turimap_admin_session', expect.any(String), expect.any(Object));
  });

  it('clears admin session on logout', async () => {
    const remove = vi.fn();
    const mockDelete = vi.fn();
    const response = await logout({
      cookies: {
        get: () => ({ value: 'test-session' }),
        delete: remove,
      },
      locals: {
        adminAuthorized: true,
        runtime: { env: { SESSION: { delete: mockDelete } } },
      },
    } as never);

    expect(response.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith('admin_session_test-session');
    expect(remove).toHaveBeenCalledWith('turimap_admin_session', { path: '/' });
  });
});

describe('privilege isolation', () => {
  it('keeps every admin API handler on the shared authorization guard', () => {
    const files = import.meta.glob('../src/pages/api/admin/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    for (const [path, source] of Object.entries(files))
      if (!path.endsWith('/login.ts'))
        expect(source).toContain('isAdmin(locals)');
  });
});
