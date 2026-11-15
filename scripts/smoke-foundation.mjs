import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const port = 3100;
const server = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    'start',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port),
  ],
  {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: {
      ...process.env,
      APP_URL: `http://localhost:${port}`,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
);
try {
  await Promise.race([
    new Promise((resolve, reject) => {
      server.stdout.on('data', (chunk) => {
        if (chunk.toString().includes('Ready')) resolve();
      });
      server.once('exit', (code) =>
        reject(new Error(`Server exited: ${code}`)),
      );
    }),
    delay(30_000, undefined, { ref: false }).then(() => {
      throw new Error('Server startup timed out');
    }),
  ]);
  const url = `http://127.0.0.1:${port}/api/v1/health`;
  // The smoke server binds only to loopback; no external credentials are sent.
  // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
  const response = await fetch(url, {
    headers: { 'x-request-id': 'smoke-foundation' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  const expected = {
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy':
      'camera=(), microphone=(), geolocation=(), payment=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'no-store',
    'x-request-id': 'smoke-foundation',
  };
  for (const [key, value] of Object.entries(expected))
    assert.equal(response.headers.get(key), value, key);
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const headers of [{}, { origin: 'https://attacker.test' }]) {
      // Loopback-only CSRF checks use the local production server.
      // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
      const denied = await fetch(url, { method, headers });
      assert.equal(denied.status, 403);
      assert.equal(
        denied.headers.get('content-type'),
        'application/problem+json',
      );
      assert.equal((await denied.json()).code, 'ORIGIN_NOT_ALLOWED');
    }
  }
  process.stdout.write('Foundation HTTP smoke passed.\n');
} finally {
  server.kill('SIGTERM');
  await once(server, 'exit');
}
