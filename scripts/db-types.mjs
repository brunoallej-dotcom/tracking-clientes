import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { format } from 'prettier';
const types = execFileSync(
  'supabase',
  ['gen', 'types', 'typescript', '--schema', 'public'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
mkdirSync('src/shared/infrastructure/supabase', { recursive: true });
writeFileSync(
  'src/shared/infrastructure/supabase/database.types.ts',
  await format(types, {
    parser: 'typescript',
    singleQuote: true,
    trailingComma: 'all',
  }),
);
