import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineRoute, type RouteServices, type Session } from './define-route';
import { RateLimitError } from '@/shared/domain/domain-error';
const session: Session = {
  userId: 'user-id',
  role: 'ceo',
  clientId: null,
  mustChangePassword: false,
};
beforeEach(() => {
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  vi.stubEnv('LOG_LEVEL', 'error');
});
const request = (body = '{}') =>
  new Request('http://localhost:3000/api/v1/example', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    body,
  });
function services(): RouteServices {
  return {
    rateLimit: vi.fn().mockResolvedValue(undefined),
    authenticate: vi.fn().mockResolvedValue(session),
  };
}
describe('Route security pipeline', () => {
  it('runs rate limit, auth, password gate, role, validation and use case in order', async () => {
    const calls: string[] = [];
    const route = defineRoute(
      {
        auth: { roles: ['ceo'] },
        rateLimit: 'mutation',
        body: z
          .object({})
          .strict()
          .transform((value) => {
            calls.push('validation');
            return value;
          }),
      },
      async () => {
        calls.push('use-case');
        return { status: 204 };
      },
      {
        async rateLimit() {
          calls.push('rate');
        },
        async authenticate() {
          calls.push('auth');
          return session;
        },
      },
    );
    expect((await route(request())).status).toBe(204);
    expect(calls).toEqual(['rate', 'auth', 'validation', 'use-case']);
  });
  it('denies access by default without authentication even if the proxy is bypassed', async () => {
    const handle = vi.fn();
    const route = defineRoute({ rateLimit: 'read' }, handle);
    expect(
      (await route(new Request('http://localhost:3000/api/v1/example'))).status,
    ).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });
  it('checks the password gate before roles and validation', async () => {
    const deps = services();
    vi.mocked(deps.authenticate).mockResolvedValue({
      ...session,
      role: 'client',
      mustChangePassword: true,
    });
    const route = defineRoute(
      {
        auth: { roles: ['ceo'] },
        rateLimit: 'mutation',
        body: z.object({}).strict(),
      },
      vi.fn(),
      deps,
    );
    expect(await (await route(request('{'))).json()).toMatchObject({
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  });
  it('checks role before parsing untrusted input', async () => {
    const deps = services();
    vi.mocked(deps.authenticate).mockResolvedValue({
      ...session,
      role: 'client',
    });
    const route = defineRoute(
      {
        auth: { roles: ['ceo'] },
        rateLimit: 'mutation',
        body: z.object({}).strict(),
      },
      vi.fn(),
      deps,
    );
    expect((await route(request('{'))).status).toBe(403);
  });
  it('allows password change exceptions to use the permitted route', async () => {
    const deps = services();
    vi.mocked(deps.authenticate).mockResolvedValue({
      ...session,
      mustChangePassword: true,
    });
    const route = defineRoute(
      {
        auth: { roles: ['ceo'], allowPasswordChange: true },
        rateLimit: 'mutation',
      },
      async () => ({ status: 204 }),
      deps,
    );
    expect((await route(request())).status).toBe(204);
  });
  it('fails closed for sensitive rate policies and fails open for liveness', async () => {
    const deps = services();
    vi.mocked(deps.rateLimit).mockRejectedValue(
      new Error('storage unavailable'),
    );
    const handle = vi
      .fn()
      .mockResolvedValue({ status: 200, body: { status: 'ok' } });
    expect(
      (
        await defineRoute(
          { auth: 'public', rateLimit: 'login' },
          handle,
          deps,
        )(request())
      ).status,
    ).toBe(503);
    expect(handle).not.toHaveBeenCalled();
    expect(
      (
        await defineRoute(
          { auth: 'public', rateLimit: 'health' },
          handle,
          deps,
        )(request())
      ).status,
    ).toBe(200);
  });
  it('never swallows rate limit denials', async () => {
    const deps = services();
    vi.mocked(deps.rateLimit).mockRejectedValue(new RateLimitError(27));
    expect(
      (
        await defineRoute(
          { auth: 'public', rateLimit: 'health' },
          vi.fn(),
          deps,
        )(request())
      ).status,
    ).toBe(429);
  });
  it('SEC-06: rejects extra body properties and unknown or duplicate query keys', async () => {
    const route = defineRoute(
      { auth: 'public', rateLimit: 'mutation', body: z.object({}).strict() },
      vi.fn(),
      services(),
    );
    expect((await route(request('{"role":"ceo"}'))).status).toBe(400);
    const read = defineRoute(
      {
        auth: 'public',
        rateLimit: 'read',
        query: z.object({ q: z.string().optional() }).strict(),
      },
      async () => ({ status: 204 }),
      services(),
    );
    for (const query of ['?unknown=1', '?q=one&q=two'])
      expect(
        (
          await read(
            new Request('http://localhost:3000/api/v1/example' + query),
          )
        ).status,
      ).toBe(400);
  });
});

it('E21: enforces body limits and JSON even for actions without an input schema', async () => {
  const route = defineRoute(
    { auth: 'public', rateLimit: 'mutation' },
    async () => ({ status: 204 }),
    services(),
  );
  const wrongType = new Request('http://localhost:3000/api/v1/action', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'text/plain' },
    body: '{}',
  });
  expect((await route(wrongType)).status).toBe(415);
  expect((await route(request('{"extra":true}'))).status).toBe(400);
  expect((await route(request('x'.repeat(17000)))).status).toBe(413);
});
it('SEC-07: propagates the retry interval on rate denials', async () => {
  const deps = services();
  vi.mocked(deps.rateLimit).mockRejectedValue(new RateLimitError(27));
  const response = await defineRoute(
    { auth: 'public', rateLimit: 'health' },
    vi.fn(),
    deps,
  )(request());
  expect(response.status).toBe(429);
  expect(response.headers.get('Retry-After')).toBe('27');
});
