import { defineConfig, globalIgnores } from 'eslint/config';
import next from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

export default defineConfig([
  ...next,
  ...typescript,
  prettier,
  globalIgnores([
    '.next/**',
    'coverage/**',
    'venv/**',
    'next-env.d.ts',
    '.claude/**',
  ]),
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/**'],
              message: 'Import another module through its public index.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/*/domain/**/*.ts', 'src/shared/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/*', 'next', 'next/*', 'zod', '@supabase/*'],
              message: 'Domain code must be pure TypeScript.',
            },
          ],
        },
      ],
    },
  },
]);
