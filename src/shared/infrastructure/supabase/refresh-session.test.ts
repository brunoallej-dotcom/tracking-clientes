import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const createServerClient = vi.hoisted(() => vi.fn());
vi.mock('@supabase/ssr', () => ({ createServerClient }));
import { refreshSession } from './refresh-session';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'local-test-placeholder');
});
it('does not contact Auth for liveness or requests without session cookies', async () => {
  for (const request of [
    new NextRequest('http://localhost:3000/api/v1/health', {
      headers: { cookie: 'sb-test-auth-token=bad-cookie' },
    }),
    new NextRequest('http://localhost:3000/api/v1/me'),
  ]) {
    expect((await refreshSession(request, new Headers())).status).toBe(200);
  }
  expect(createServerClient).not.toHaveBeenCalled();
});
it('refreshes via getUser, forwards new cookies and always sets secure server-only flags', async () => {
  const getUser = vi
    .fn()
    .mockResolvedValue({ data: { user: null }, error: null });
  createServerClient.mockReturnValue({ auth: { getUser } });
  const request = new NextRequest('http://localhost:3000/api/v1/me', {
    headers: { cookie: 'sb-test-auth-token=old' },
  });
  const headers = new Headers({ 'x-request-id': 'trace-123' });
  getUser.mockImplementation(async () => {
    const options = createServerClient.mock.calls[0]![2];
    options.cookies.setAll([
      {
        name: 'sb-test-auth-token',
        value: 'new',
        options: { secure: false, httpOnly: false, sameSite: 'none' },
      },
    ]);
    options.cookies.setAll([
      { name: 'sb-test-auth-token.1', value: 'chunk', options: {} },
    ]);
    return { data: { user: null }, error: null };
  });
  const response = await refreshSession(request, headers);
  expect(getUser).toHaveBeenCalledOnce();
  expect(request.cookies.get('sb-test-auth-token')?.value).toBe('new');
  expect(response.headers.get('x-middleware-request-cookie')).toContain(
    'sb-test-auth-token=new',
  );
  expect(response.headers.get('x-middleware-request-x-request-id')).toBe(
    'trace-123',
  );
  const cookies = response.cookies.getAll();
  expect(cookies).toHaveLength(2);
  for (const cookie of cookies)
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
});
