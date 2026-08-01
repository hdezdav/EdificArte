import { expect, it, vi } from 'vitest';
import { POST as login } from '../src/pages/api/admin/login';
import { POST as logout } from '../src/pages/api/admin/logout';

it('handles invalid credentials on login and clears session on logout', async () => {
  const mockEnv = {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      }),
    },
    SESSION: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Env;

  const denied = await login({
    request: new Request('https://app.test/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'x@y.z', password: 'bad' }),
    }),
    cookies: { set: vi.fn() },
    locals: {
      runtime: { env: mockEnv },
    },
  } as never);

  const remove = vi.fn();
  const signedOut = await logout({
    cookies: {
      get: () => ({ value: 'session-123' }),
      delete: remove,
    },
    locals: {
      adminAuthorized: true,
      runtime: { env: mockEnv },
    },
  } as never);

  expect([
    denied.status,
    signedOut.status,
    remove.mock.calls.length > 0,
  ]).toEqual([401, 200, true]);
});
