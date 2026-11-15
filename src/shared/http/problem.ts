import {
  DomainError,
  RateLimitError,
  errorStatuses,
} from '@/shared/domain/domain-error';
import { secureResponse } from './security-headers';
export function problemResponse(error: unknown, requestId: string): Response {
  const code = error instanceof DomainError ? error.code : 'INTERNAL_ERROR';
  const status = errorStatuses[code];
  const response = Response.json(
    { type: 'about:blank', title: code, status, code, requestId },
    {
      status,
      headers: { 'Content-Type': 'application/problem+json' },
    },
  );
  if (code === 'RATE_LIMITED')
    response.headers.set(
      'Retry-After',
      String(
        error instanceof RateLimitError &&
          Number.isFinite(error.retryAfterSeconds)
          ? Math.max(1, Math.ceil(error.retryAfterSeconds))
          : 60,
      ),
    );
  return secureResponse(response, requestId);
}
