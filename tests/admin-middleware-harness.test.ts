import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:middleware', () => ({
  defineMiddleware: (handler: unknown) => handler,
}));

const { onRequest } = await import('../src/middleware');

class BrowserCookies {
  entries = new Map<
    string,
    { value: string; options: Record<string, unknown> }
  >();

  for(url: URL) {
    const visible = (name: string) => {
      const cookie = this.entries.get(name);
      return cookie &&
        url.pathname.startsWith(String(cookie.options.path || '/'))
        ? cookie
        : undefined;
    };
    return {
      get: (name: string) => visible(name),
      set: (name: string, value: string, options: Record<string, unknown>) =>
        this.entries.set(name, { value, options }),
      delete: (name: string) => this.entries.delete(name),
    };
  }

  header(url: URL) {
    return [...this.entries]
      .filter(([, cookie]) =>
        url.pathname.startsWith(String(cookie.options.path || '/'))
      )
      .map(([name, cookie]) => `${name}=${cookie.value}`)
      .join('; ');
  }
}

const mockSessions = new Map<string, string>();
const mockKVSession = {
  get: async (key: string) => mockSessions.get(key) || null,
  put: async (key: string, val: string) => { mockSessions.set(key, val); },
  delete: async (key: string) => { mockSessions.delete(key); },
};

const configuredEnv = {
  SESSION: mockKVSession,
  DB: {} as any,
  CACHE: mockKVSession,
} as unknown as Env;

async function request(
  jar: BrowserCookies,
  path: string,
  init: RequestInit = {},
  env: Env = configuredEnv
) {
  const url = new URL(path, 'https://app.test');
  const headers = new Headers(init.headers);
  const cookie = jar.header(url);
  if (cookie) headers.set('cookie', cookie);
  const locals = {
    runtime: { env, cf: {}, caches: {}, ctx: {} },
  } as unknown as App.Locals;
  let nextCalled = false;
  const response = (await onRequest(
    {
      request: new Request(url, { ...init, headers }),
      cookies: jar.for(url),
      locals,
    } as never,
    async () => {
      nextCalled = true;
      return new Response('next');
    }
  )) as Response;
  return { response, locals, nextCalled };
}

describe('Astro admin middleware integration', () => {
  beforeEach(() => {
    mockSessions.clear();
    mockSessions.set('admin_session_test-123', JSON.stringify({ userId: 'admin-1', role: 'admin', email: 'admin@turimap.app' }));
  });

  it('shares the session-bound CSRF cookie with unsafe admin APIs', async () => {
    const jar = new BrowserCookies();
    jar.entries.set('turimap_admin_session', { value: 'test-123', options: { path: '/' } });

    await request(jar, '/admin');
    const csrf = jar.entries.get('turimap_admin_csrf')!;
    expect(csrf).toBeDefined();

    const valid = await request(jar, '/api/admin/products', {
      method: 'POST',
      headers: {
        origin: 'https://app.test',
        'x-csrf-token': csrf.value,
        'x-request-id': 'spoofed',
      },
    });
    expect([valid.response.status, valid.nextCalled]).toEqual([200, true]);
    expect(valid.locals.requestId).not.toBe('spoofed');
  });

  it('denies unsafe requests without valid CSRF', async () => {
    const jar = new BrowserCookies();
    jar.entries.set('turimap_admin_session', { value: 'test-123', options: { path: '/' } });

    const denied = await request(jar, '/api/admin/products', {
      method: 'POST',
      headers: {
        origin: 'https://app.test',
        'x-csrf-token': 'wrong',
      },
    });
    expect([denied.response.status, denied.nextCalled]).toEqual([403, false]);
  });
});
