import { expect, it, vi } from 'vitest';
import { GET } from '@/app/api/v1/health/route';
it('getHealth: the real handler remains live without Auth or database configuration', async () => {
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  vi.stubEnv('LOG_LEVEL', 'error');
  const response = await GET(
    new Request('http://localhost:3000/api/v1/health'),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});
