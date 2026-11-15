import { DomainError } from '@/shared/domain/domain-error';
export const MAX_BODY_BYTES = 16 * 1024;
export async function readJson(request: Request): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  ) {
    throw new DomainError('UNSUPPORTED_MEDIA_TYPE');
  }
  const length = request.headers.get('content-length');
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)
  ) {
    throw new DomainError('PAYLOAD_TOO_LARGE');
  }
  if (!request.body) throw new DomainError('VALIDATION_FAILED');
  const reader = request.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new DomainError('PAYLOAD_TOO_LARGE');
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('VALIDATION_FAILED');
  } finally {
    reader.releaseLock();
  }
}
