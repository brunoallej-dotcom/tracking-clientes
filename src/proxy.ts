import { NextResponse, type NextRequest } from 'next/server';
import { getAppEnv } from '@/shared/infrastructure/env';
import { createLogger } from '@/shared/infrastructure/logger';
import { refreshSession } from '@/shared/infrastructure/supabase/refresh-session';
import { assertOrigin } from '@/shared/http/origin';
import { getRequestId } from '@/shared/http/request-id';
import { problemResponse } from '@/shared/http/problem';
import { secureResponse } from '@/shared/http/security-headers';
export async function proxy(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const headers = new Headers(request.headers);
  headers.set('x-request-id', requestId);
  try {
    assertOrigin(request, getAppEnv().APP_URL);
  } catch (error) {
    return problemResponse(error, requestId);
  }
  let response: NextResponse;
  try {
    response = await refreshSession(request, headers);
  } catch {
    createLogger().error({ requestId, event: 'session.refresh_failed' });
    // Authorization remains in the handler even when the refresh service fails.
    response = NextResponse.next({ request: { headers } });
  }
  return secureResponse(response, requestId);
}
export const config = { matcher: ['/api/:path*'] };
