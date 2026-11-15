import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseEnv } from '../env';
export async function refreshSession(
  request: NextRequest,
  headers: Headers,
): Promise<NextResponse> {
  let response = NextResponse.next({ request: { headers } });
  // Liveness must be independent of Auth and database availability.
  if (
    request.nextUrl.pathname === '/api/v1/health' ||
    !request.cookies
      .getAll()
      .some(
        ({ name }) => name.startsWith('sb-') && name.includes('-auth-token'),
      )
  )
    return response;
  const env = getSupabaseEnv();
  const supabase = createServerClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([
              AbortSignal.timeout(10_000),
              ...(init?.signal ? [init.signal] : []),
            ]),
          }),
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookies) {
          for (const { name, value } of cookies)
            request.cookies.set(name, value);
          headers.set('cookie', request.cookies.toString());
          const previousCookies = response.cookies.getAll();
          response = NextResponse.next({ request: { headers } });
          for (const cookie of previousCookies) response.cookies.set(cookie);
          for (const { name, value, options } of cookies)
            response.cookies.set(name, value, {
              ...options,
              httpOnly: true,
              secure: true,
              sameSite: 'lax',
              path: '/',
            });
        },
      },
    },
  );
  await supabase.auth.getUser();
  return response;
}
