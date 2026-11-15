#!/usr/bin/env node
// PreToolUse (Bash)
// Denies destructive or secret-leaking commands; asks for confirmation on outward-facing ones.
import { ask, deny, readInput } from './lib/hook-io.mjs';

const input = readInput();
const command = String(input.tool_input?.command ?? '');
if (!command.trim()) process.exit(0);

// Env files other than .env.example (e.g. .env, .env.local, $DIR/.env.production).
const ENV_FILE = /(?:^|[\s'"=/<>])\.env(?:\.(?!example\b)[\w.-]+)?(?=$|[\s'";|&)<>])/;

const DENY = [
  [ENV_FILE, 'o comando referencia um arquivo .env com segredos. Peça ao usuário para executá-lo'],
  [/\bsupabase\s+db\s+reset\b[^;&|]*--(?:linked|db-url)\b/, 'reset de banco REMOTO apaga dados reais'],
  [/\bsupabase\s+(?:projects|orgs)\s+delete\b/, 'exclusão de projeto/organização Supabase'],
  [/\bgit\s+push\b[^;&|]*(?:\s--force(?!-with-lease)\b|\s-f\b)/, 'force push reescreve histórico compartilhado'],
  [/\brm\s+-[a-zA-Z]*[rR][a-zA-Z]*\s+[^;&|]*(?:supabase\/migrations|\.git\b|contracts\b|docs\b)/, 'remoção recursiva de migrations, contrato, docs ou .git'],
  [/\b(?:curl|wget)\b[^|]*\|\s*(?:ba|z|da)?sh\b/, 'execução de script remoto via pipe para shell'],
];

const ASK = [
  [/\bsupabase\s+db\s+push\b/, 'aplica migrations em um banco remoto (deveria rodar pelo CI)'],
  [/\bsupabase\s+(?:link|config\s+push|secrets\s+(?:set|unset))\b/, 'altera configuração ou segredos do projeto Supabase remoto'],
  [/\bvercel\b[^;&|]*(?:--prod\b|\bdeploy\b|\bpromote\b|\brollback\b|\benv\s+(?:pull|add|rm)\b)/, 'deploy ou variáveis de ambiente na Vercel'],
  [/\bgit\s+push\b/, 'publica commits no remoto'],
  [/\bnpm\s+(?:i|install|add)\s+(?!-{1,2}\S*\s*$)\S/, 'adiciona dependência (supply chain: justificar e fixar versão)'],
  [/\b(?:pnpm|yarn|bun)\s+add\b/, 'adiciona dependência (supply chain: justificar e fixar versão)'],
  [/\bpsql\b[^;&|]*(?:supabase\.co|pooler\.supabase\.com)/, 'conexão direta a um banco Supabase remoto'],
];

for (const [regex, why] of DENY) {
  if (regex.test(command)) deny(`Bloqueado pelo guard-bash: ${why}.`);
}
for (const [regex, why] of ASK) {
  if (regex.test(command)) ask(`Confirmação necessária (guard-bash): ${why}.`);
}

process.exit(0);
