import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', 'src'],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);
const secretName = ['SUPABASE', 'SECRET', 'KEY'].join('_');
const allowed = new Set([
  'src/shared/infrastructure/env.ts',
  'src/shared/infrastructure/supabase/admin-client.ts',
]);
for (const file of files) {
  if (file.endsWith('.test.ts')) continue;
  const source = readFileSync(file, 'utf8');
  if (
    (source.includes(secretName) && !allowed.has(file)) ||
    /NEXT_PUBLIC_/.test(source) ||
    /console\.log\(/.test(source)
  ) {
    throw new Error(`Security boundary violation: ${file}`);
  }
}
