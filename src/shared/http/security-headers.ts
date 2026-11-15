export const securityHeaders = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
} as const;

export function secureResponse(
  response: Response,
  requestId: string,
): Response {
  for (const [key, value] of Object.entries(securityHeaders))
    response.headers.set(key, value);
  response.headers.set('X-Request-Id', requestId);
  response.headers.delete('X-Powered-By');
  return response;
}
