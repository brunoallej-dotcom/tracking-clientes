import { z } from 'zod';
import { DomainError } from '@/shared/domain/domain-error';
import { getAppEnv } from '@/shared/infrastructure/env';
import { createLogger } from '@/shared/infrastructure/logger';
import { assertOrigin, mutationMethods } from './origin';
import { problemResponse } from './problem';
import { readJson } from './read-json';
import { getRequestId } from './request-id';
import { secureResponse } from './security-headers';

export interface Session {
  userId: string;
  role: 'ceo' | 'client';
  clientId: string | null;
  mustChangePassword: boolean;
}
export interface RouteServices {
  rateLimit(request: Request, policy: string): Promise<void>;
  authenticate(request: Request): Promise<Session>;
}
const unavailableServices: RouteServices = {
  async rateLimit() {
    throw new DomainError('SERVICE_UNAVAILABLE');
  },
  async authenticate() {
    throw new DomainError('UNAUTHENTICATED');
  },
};
const empty = z.object({}).strict();
interface RouteOptions<P, Q, B> {
  auth?: 'public' | { roles: Session['role'][]; allowPasswordChange?: boolean };
  rateLimit: string;
  failClosed?: boolean;
  params?: z.ZodType<P>;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
}
export function defineRoute<
  P = Record<string, never>,
  Q = Record<string, never>,
  B = undefined,
>(
  options: RouteOptions<P, Q, B>,
  handle: (input: {
    params: P;
    query: Q;
    body: B;
    session: Session | null;
    requestId: string;
  }) => Promise<{ status: number; body?: unknown }>,
  services: RouteServices = unavailableServices,
) {
  return async (
    request: Request,
    context?: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    const requestId = getRequestId(request.headers);
    const logger = createLogger().child({ requestId });
    const start = performance.now();
    let response: Response;
    try {
      assertOrigin(request, getAppEnv().APP_URL);
      try {
        await services.rateLimit(request, options.rateLimit);
      } catch (error) {
        if (error instanceof DomainError && error.code === 'RATE_LIMITED')
          throw error;
        logger.error({ event: 'rate_limit.unavailable' });
        if (
          options.failClosed ||
          ['login', 'password'].includes(options.rateLimit)
        )
          throw new DomainError('SERVICE_UNAVAILABLE');
      }
      let session: Session | null = null;
      if (options.auth !== 'public') {
        session = await services.authenticate(request);
        if (session.mustChangePassword && !options.auth?.allowPasswordChange)
          throw new DomainError('PASSWORD_CHANGE_REQUIRED');
        if (options.auth && !options.auth.roles.includes(session.role))
          throw new DomainError('FORBIDDEN');
      }
      const params = (options.params ?? empty).safeParse(
        (await context?.params) ?? {},
      );
      const searchParams = new URL(request.url).searchParams;
      if (new Set(searchParams.keys()).size !== [...searchParams.keys()].length)
        throw new DomainError('VALIDATION_FAILED');
      const query = (options.query ?? empty).safeParse(
        Object.fromEntries(searchParams),
      );
      const input = mutationMethods.has(request.method)
        ? await readJson(request)
        : undefined;
      const body = options.body
        ? options.body.safeParse(input)
        : mutationMethods.has(request.method)
          ? empty.safeParse(input)
          : undefined;
      if (!params.success || !query.success || (body && !body.success))
        throw new DomainError('VALIDATION_FAILED');
      const result = await handle({
        params: params.data as P,
        query: query.data as Q,
        body: body?.data as B,
        session,
        requestId,
      });
      response =
        result.status === 204
          ? new Response(null, { status: 204 })
          : Response.json(result.body, { status: result.status });
    } catch (error) {
      // Untrusted error messages may contain PII or credentials. Log only the catalog code.
      logger.error({
        event: 'request.failed',
        code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR',
      });
      response = problemResponse(error, requestId);
    }
    logger.info(
      {
        method: request.method,
        status: response.status,
        durationMs: performance.now() - start,
      },
      'request.completed',
    );
    return secureResponse(response, requestId);
  };
}
