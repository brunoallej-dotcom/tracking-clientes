import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { GET } from '@/app/api/v1/health/route';
import { proxy } from '@/proxy';
import { defineRoute, type RouteServices } from '@/shared/http/define-route';
import { securityHeaders } from '@/shared/http/security-headers';
const deps: RouteServices = {
  async rateLimit() {},
  async authenticate() {
    throw new Error('must not authenticate a public endpoint');
  },
};
beforeEach(() => {
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  vi.stubEnv('LOG_LEVEL', 'error');
});
function mutation(body: string, extra: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/v1/test', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      ...extra,
    },
    body,
  });
}
describe('Foundation', () => {
  it('SEC-08: health returns only status with every baseline header and a request ID', async () => {
    const response = await GET(
      new Request('http://localhost:3000/api/v1/health'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    for (const [key, value] of Object.entries(securityHeaders))
      expect(response.headers.get(key)).toBe(value);
    expect(response.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers.has('x-powered-by')).toBe(false);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
  });
  it('SEC-08: propagates a bounded request ID and replaces invalid client IDs', async () => {
    const response = await GET(
      new Request('http://localhost:3000/api/v1/health', {
        headers: { 'x-request-id': 'trace-123' },
      }),
    );
    expect(response.headers.get('x-request-id')).toBe('trace-123');
    const invalid = await GET(
      new Request('http://localhost:3000/api/v1/health', {
        headers: { 'x-request-id': 'x'.repeat(65) },
      }),
    );
    expect(invalid.headers.get('x-request-id')).not.toBe('x'.repeat(65));
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'SEC-09: proxy blocks %s with missing or foreign Origin',
    async (method) => {
      for (const origin of [
        undefined,
        'https://attacker.test',
        'null',
        'http://localhost:3000.attacker.test',
      ]) {
        const response = await proxy(
          new NextRequest('http://localhost:3000/api/v1/health', {
            method,
            headers: origin ? { origin } : {},
          }),
        );
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          code: 'ORIGIN_NOT_ALLOWED',
          status: 403,
        });
        for (const [key, value] of Object.entries(securityHeaders))
          expect(response.headers.get(key)).toBe(value);
      }
    },
  );
  it('SEC-09: wrapper also rejects foreign Origin when proxy is bypassed', async () => {
    const route = defineRoute(
      { auth: 'public', rateLimit: 'mutation' },
      vi.fn(),
      deps,
    );
    expect(
      (await route(mutation('{}', { origin: 'https://attacker.test' }))).status,
    ).toBe(403);
  });
  it('SEC-09: permits the configured Origin and forwards correlation on the request', async () => {
    const response = await proxy(
      new NextRequest('http://localhost:3000/api/v1/health', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'x-request-id': 'trace-123',
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-x-request-id')).toBe(
      'trace-123',
    );
  });
  it('SEC-11: hides unexpected database errors and stack traces in problem+json', async () => {
    const route = defineRoute(
      { auth: 'public', rateLimit: 'read' },
      async () => {
        throw new Error('SELECT secret FROM internal_table; private stack');
      },
      deps,
    );
    const response = await route(
      new Request('http://localhost:3000/api/v1/failure'),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe(
      'application/problem+json',
    );
    const body = await response.json();
    expect(body).toEqual({
      type: 'about:blank',
      title: 'INTERNAL_ERROR',
      status: 500,
      code: 'INTERNAL_ERROR',
      requestId: response.headers.get('x-request-id'),
    });
  });
  it('SEC-11: malformed JSON returns 400 without parser internals', async () => {
    const route = defineRoute(
      { auth: 'public', rateLimit: 'mutation', body: z.object({}).strict() },
      vi.fn(),
      deps,
    );
    const response = await route(mutation('{'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('E21: rejects oversized bodies with or without Content-Length, measured in bytes', async () => {
    const route = defineRoute(
      {
        auth: 'public',
        rateLimit: 'mutation',
        body: z.object({ value: z.string() }).strict(),
      },
      vi.fn(),
      deps,
    );
    for (const extra of [{}, { 'content-length': '20000' }] as Record<
      string,
      string
    >[])
      expect(
        (
          await route(
            mutation(JSON.stringify({ value: 'é'.repeat(9000) }), extra),
          )
        ).status,
      ).toBe(413);
  });
  it('E21: requires application/json and accepts charset parameter', async () => {
    const route = defineRoute(
      { auth: 'public', rateLimit: 'mutation', body: z.object({}).strict() },
      async () => ({ status: 204 }),
      deps,
    );
    expect(
      (await route(mutation('{}', { 'content-type': 'text/plain' }))).status,
    ).toBe(415);
    expect(
      (
        await route(
          mutation('{}', { 'content-type': 'application/json; charset=utf-8' }),
        )
      ).status,
    ).toBe(204);
  });
});
