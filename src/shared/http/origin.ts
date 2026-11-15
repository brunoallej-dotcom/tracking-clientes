import { DomainError } from '@/shared/domain/domain-error';
export const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export function assertOrigin(request: Request, appUrl: string): void {
  if (
    mutationMethods.has(request.method) &&
    request.headers.get('origin') !== new URL(appUrl).origin
  ) {
    throw new DomainError('ORIGIN_NOT_ALLOWED');
  }
}
