#!/usr/bin/env node
// Stop
// If TypeScript files changed and dependencies are installed, run `npm run typecheck` and keep
// Claude working until it is green. No-op before Wave 0 (no package.json / node_modules).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { block, projectDir, readInput } from './lib/hook-io.mjs';

const input = readInput();
if (input.stop_hook_active) process.exit(0); // already continuing because of this hook: avoid loops

const root = projectDir(input);
const pkgPath = path.join(root, 'package.json');
if (!existsSync(pkgPath) || !existsSync(path.join(root, 'node_modules'))) process.exit(0);

let pkg;
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
} catch {
  process.exit(0);
}
if (!pkg.scripts?.typecheck) process.exit(0);

let status = '';
try {
  status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
} catch {
  process.exit(0);
}
const changedTs = status.split('\n').some((line) => /\.(ts|tsx|mts)$/.test(line.trim()));
if (!changedTs) process.exit(0);

try {
  execFileSync('npm', ['run', '--silent', 'typecheck'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 150_000,
  });
} catch (error) {
  if (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM') {
    process.stderr.write('[stop-quality-gate] typecheck excedeu o tempo; não bloqueando.\n');
    process.exit(0);
  }
  const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
  block(`npm run typecheck falhou. Corrija os erros de tipo antes de encerrar:\n${output}`);
}
process.exit(0);
