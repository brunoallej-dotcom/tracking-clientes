import { randomUUID } from 'node:crypto';
export function getRequestId(headers: Headers): string {
  const value = headers.get('x-request-id');
  return value && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : randomUUID();
}
