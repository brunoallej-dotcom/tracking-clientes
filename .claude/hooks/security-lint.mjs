#!/usr/bin/env node
// PostToolUse (Write|Edit|MultiEdit)
// Reads the file as written and points out violations of the project's security rules
// (AGENTS.md "Regras de segurança inegociáveis"). It never edits; findings go back to Claude.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { block, projectDir, readInput, toRelative } from './lib/hook-io.mjs';

const input = readInput();
const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);

const root = projectDir(input);
const rel = toRelative(filePath, root);
const abs = path.resolve(root, rel);
if (rel.startsWith('.claude/') || rel.startsWith('node_modules/') || !existsSync(abs)) process.exit(0);

const text = readFileSync(abs, 'utf8');
const findings = [];
const lineOf = (index) => text.slice(0, index).split('\n').length;
const add = (index, message) => findings.push(`${rel}:${lineOf(index)} — ${message}`);

if (rel.endsWith('.sql') && rel.startsWith('supabase/')) lintSql();
if (/\.(ts|tsx|mts|js|mjs)$/.test(rel) && /^(src|scripts|tests)\//.test(rel)) lintTs();

if (findings.length > 0) {
  block(
    `security-lint encontrou ${findings.length} ponto(s) para corrigir ou justificar ` +
      `(ver AGENTS.md › Regras de segurança):\n- ${findings.join('\n- ')}`,
  );
}
process.exit(0);

function lintSql() {
  const lower = text.toLowerCase();

  // Tables in public need RLS enabled AND forced.
  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi;
  for (const m of text.matchAll(tableRe)) {
    const schema = (m[1] ?? 'public').toLowerCase();
    const table = m[2].toLowerCase();
    if (schema !== 'public') continue;
    const qualified = `(?:public\\.)?"?${table}"?`;
    if (!new RegExp(`alter\\s+table\\s+${qualified}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(text)) {
      add(m.index, `tabela public.${table} sem "enable row level security"`);
    }
    if (!new RegExp(`alter\\s+table\\s+${qualified}\\s+force\\s+row\\s+level\\s+security`, 'i').test(text)) {
      add(m.index, `tabela public.${table} sem "force row level security"`);
    }
  }

  // Functions: security definer hygiene.
  const fnRe = /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(/gi;
  for (const m of text.matchAll(fnRe)) {
    const name = m[1].replaceAll('"', '');
    const headerEnd = lower.indexOf('as $', m.index);
    const header = lower.slice(m.index, headerEnd === -1 ? undefined : headerEnd);
    if (!header.includes('security definer')) continue;
    if (!/set\s+search_path\s*(?:=|to)\s*''/.test(header)) {
      add(m.index, `função ${name} é security definer sem "set search_path = ''"`);
    }
    const bodyStart = lower.indexOf('$$', m.index);
    const bodyEnd = bodyStart === -1 ? -1 : lower.indexOf('$$', bodyStart + 2);
    const body = bodyStart === -1 ? '' : lower.slice(bodyStart, bodyEnd === -1 ? undefined : bodyEnd);
    const isPublic = !name.toLowerCase().startsWith('private.') && !name.toLowerCase().startsWith('auth.');
    if (isPublic && !/assert_ceo|is_ceo|auth_role|auth\.uid\(\)|auth\.role\(\)/.test(body)) {
      add(m.index, `função ${name} (security definer, exposta) sem checagem de authz visível (assert_ceo/auth.uid)`);
    }
    const shortName = name.split('.').pop().toLowerCase();
    if (isPublic && !new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+(?:public\\.)?"?${shortName}"?`, 'i').test(text)) {
      add(m.index, `função ${name} sem "revoke execute … from public, anon"`);
    }
  }

  const checks = [
    [/\bexecute\s+(?!on\b|function\b|procedure\b)\S/gi, 'EXECUTE dinâmico em PL/pgSQL (risco de SQL injection; use SQL estático)'],
    [/\bgrant\b[^;]*\bto\b[^;]*\banon\b/gi, 'grant para anon'],
    [/\b(?:using|with\s+check)\s*\(\s*true\s*\)/gi, 'policy com (true): justifique em comentário ou restrinja'],
    [/\bdisable\s+row\s+level\s+security\b/gi, 'RLS desabilitada'],
    [/raw_user_meta_data[^;]*\brole\b/gi, 'papel lido de raw_user_meta_data (editável pelo usuário); use raw_app_meta_data/profiles'],
  ];
  for (const [regex, message] of checks) {
    for (const m of text.matchAll(regex)) add(m.index, message);
  }
}

function lintTs() {
  const isTest = /(^tests\/|\.test\.[cm]?[jt]sx?$)/.test(rel);
  const inSrc = rel.startsWith('src/');
  const allowedSecretFiles = new Set([
    'src/shared/infrastructure/env.ts',
    'src/shared/infrastructure/supabase/admin-client.ts',
  ]);

  const checks = [
    [/\.(?:or|filter|not|textSearch)\(\s*`[^`]*\$\{/g, 'input interpolado em filtro PostgREST (injeção de filtro); use .eq/.in/.ilike com valor validado'],
    [/\.(?:or|filter|not|textSearch)\(\s*['"][^'"]*['"]\s*\+/g, 'filtro PostgREST montado por concatenação; use .eq/.in/.ilike'],
    [/\.(?:query|raw|unsafe)\(\s*`[^`]*\$\{/g, 'SQL montado com template string'],
    [/\bNEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE)/g, 'segredo com prefixo NEXT_PUBLIC_'],
    [/\beval\s*\(|\bnew\s+Function\s*\(/g, 'eval/new Function'],
    [/dangerouslySetInnerHTML/g, 'dangerouslySetInnerHTML (risco de XSS)'],
  ];
  if (!allowedSecretFiles.has(rel) && !isTest && !rel.startsWith('scripts/')) {
    checks.push([/\bSUPABASE_(?:SECRET|SERVICE_ROLE)_KEY\b/g, 'secret key referenciada fora de env.ts/admin-client.ts']);
  }
  if (inSrc && !isTest) {
    checks.push([/\bconsole\.(?:log|info|debug|warn|error)\s*\(/g, 'console.* em src/ (use o logger pino)']);
    checks.push([/\.auth\.getSession\s*\(/g, 'auth.getSession() no servidor; use auth.getUser() para decidir acesso']);
  }
  for (const [regex, message] of checks) {
    for (const m of text.matchAll(regex)) add(m.index, message);
  }

  // `any` must be justified on the same or previous line.
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/(?::\s*any\b|\bas\s+any\b|<any>)/.test(line)) {
      const context = `${lines[i - 1] ?? ''}\n${line}`;
      if (!/eslint-disable|justif|reason:/i.test(context)) {
        findings.push(`${rel}:${i + 1} — "any" sem comentário justificando`);
      }
    }
  });

  // Client components must never touch the admin client.
  if (/^\s*['"]use client['"]/.test(text) && /admin-client/.test(text)) {
    findings.push(`${rel}:1 — componente "use client" importando o admin client`);
  }

  // route.ts only re-exports handlers (AGENTS.md › Regras de fronteira).
  if (/^src\/app\/api\/.+\/route\.ts$/.test(rel)) {
    const meaningful = lines.filter((l) => l.trim() && !l.trim().startsWith('//'));
    const onlyExports = meaningful.every((l) => /^\s*export\s+(?:\{[^}]*\}\s+from\s+['"][^'"]+['"]|const\s+(?:runtime|dynamic|preferredRegion|maxDuration)\s*=)/.test(l));
    if (!onlyExports) findings.push(`${rel}:1 — route.ts deve só re-exportar o handler do módulo (sem lógica)`);
  }
}
