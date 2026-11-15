import { defineRoute } from './define-route';
export const GET = defineRoute(
  { auth: 'public', rateLimit: 'health' },
  async () => ({ status: 200, body: { status: 'ok' } }),
);
