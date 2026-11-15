#!/usr/bin/env node
// PreToolUse (Write|Edit|MultiEdit|NotebookEdit)
// Blocks: writes to env files (except .env.example), edits to migrations already on main,
// and content that looks like a real secret.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { deny, projectDir, readInput, toRelative } from './lib/hook-io.mjs';

const input = readInput();
const toolInput = input.tool_input ?? {};
const filePath = toolInput.file_path ?? toolInput.notebook_path;
if (!filePath) process.exit(0);

const root = projectDir(input);
const rel = toRelative(filePath, root);
const base = path.basename(rel);

// 1. Env files hold real secrets and never pass through the agent.
if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
  deny(
    `Bloqueado: "${rel}" é arquivo de segredos. Só o .env.example (placeholders) pode ser editado. ` +
      'Peça ao usuário para alterar o arquivo real.',
  );
}

// 2. Migrations already merged into main are immutable (AGENTS.md, rule 14).
if (/^supabase\/migrations\/.+\.sql$/.test(rel) && existsOnMain(rel)) {
  deny(
    `Bloqueado: "${rel}" já está na main e migrations aplicadas são imutáveis. ` +
      'Crie uma migration nova com `npx supabase migration new <nome>` (skill new-migration).',
  );
}

// 3. Secret-looking content. Hook sources are skipped (they contain the patterns themselves).
if (!rel.startsWith('.claude/hooks/')) {
  const content = [
    toolInput.content,
    toolInput.new_string,
    toolInput.new_source,
    ...(Array.isArray(toolInput.edits) ? toolInput.edits.map((e) => e?.new_string) : []),
  ]
    .filter((v) => typeof v === 'string')
    .join('\n');

  const patterns = [
    [/sb_secret_[A-Za-z0-9_-]{16,}/, 'secret key do Supabase (sb_secret_…)'],
    [/sb_publishable_[A-Za-z0-9_-]{16,}/, 'publishable key do Supabase (vai em env, não no código)'],
    [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT (anon/service_role key ou token de sessão)'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada'],
    [/postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i, 'connection string do Postgres com senha'],
    [/\bNEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE)[A-Z0-9_]*/, 'segredo com prefixo NEXT_PUBLIC_ (iria para o bundle do navegador)'],
    [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'token do GitHub'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'access key da AWS'],
    [/\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/, 'chave de API live'],
  ];

  for (const [regex, label] of patterns) {
    if (regex.test(content)) {
      deny(
        `Bloqueado: o conteúdo para "${rel}" parece conter ${label}. Segredos ficam só em variáveis de ` +
          'ambiente (.env.local / Vercel). Use placeholder ou leia via src/shared/infrastructure/env.ts.',
      );
    }
  }
}

process.exit(0);

function existsOnMain(relPath) {
  for (const ref of ['origin/main', 'main']) {
    try {
      execFileSync('git', ['cat-file', '-e', `${ref}:${relPath}`], { cwd: root, stdio: 'ignore' });
      return true;
    } catch {
      // ref missing or file not on that ref: try the next one
    }
  }
  return false;
}
