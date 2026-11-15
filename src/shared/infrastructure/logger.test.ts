import { beforeEach, expect, it, vi } from 'vitest';
import { createLogger } from './logger';
import { getAppEnv, getSupabaseEnv } from './env';
beforeEach(() => {
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  vi.stubEnv('LOG_LEVEL', 'info');
});
it('SEC-13: redacts credentials and PII at top level and in request structures', () => {
  const lines: string[] = [];
  const logger = createLogger({
    write(line) {
      lines.push(line);
    },
  });
  logger.info(
    {
      requestId: 'trace-123',
      email: 'sensitive-email',
      password: 'sensitive-password',
      fullName: 'sensitive-name',
      ip: 'sensitive-ip',
      body: {
        temporaryPassword: 'sensitive-temporary',
        newPassword: 'sensitive-new',
        token: 'sensitive-token',
      },
      req: {
        headers: {
          cookie: 'sensitive-cookie',
          authorization: 'sensitive-auth',
        },
      },
    },
    'test',
  );
  expect(lines.join('')).not.toContain('sensitive-');
  expect(JSON.parse(lines[0]!).requestId).toBe('trace-123');
});
it('rejects invalid server configuration without including its value in errors', () => {
  vi.stubEnv('APP_URL', 'https://example.test/private-token');
  vi.stubEnv('LOG_LEVEL', 'sensitive-invalid');
  expect(() => getAppEnv()).toThrow('Invalid server configuration');
  vi.stubEnv('SUPABASE_URL', 'sensitive-invalid');
  expect(() => getSupabaseEnv()).toThrow('Invalid server configuration');
});
