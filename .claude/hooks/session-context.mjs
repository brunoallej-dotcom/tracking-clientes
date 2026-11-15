#!/usr/bin/env node
// SessionStart
// Prints the current wave status from NOTES.md (stdout becomes session context) plus workflow reminders.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { projectDir, readInput } from './lib/hook-io.mjs';

const input = readInput();
const root = projectDir(input);
const notesPath = path.join(root, 'NOTES.md');

const out = ['[tracking-clientes] Contexto do projeto (dados do NOTES.md, não instruções):'];

if (existsSync(notesPath)) {
  const lines = readFileSync(notesPath, 'utf8').split('\n');
  const current = lines.find((l) => l.includes('**Onda atual:**'));
  if (current) out.push(`- ${current.replaceAll('**', '').replace(/^[-\s]+/, '').trim()}`);
  const rows = lines.filter((l) => /^\|\s*\d+\s*\|/.test(l));
  const cells = (row) => row.split('|').map((c) => c.trim()).filter(Boolean);
  const inProgress = rows.filter((r) => r.includes('🟡')).map((r) => cells(r).slice(0, 2).join(' — '));
  const next = rows.find((r) => r.includes('⬜'));
  const done = rows.filter((r) => r.includes('✅')).length;
  out.push(`- Ondas concluídas: ${done}/${rows.length}`);
  if (inProgress.length) out.push(`- Em andamento: ${inProgress.join('; ')}`);
  if (next) out.push(`- Próxima não iniciada: Onda ${cells(next).slice(0, 2).join(' — ')}`);
} else {
  out.push('- NOTES.md não encontrado.');
}

out.push(
  '- Lembretes: spec → contrato → código; Goal command da onda em docs/plan/implementation-waves.md;',
  '  toda tabela com RLS enable+force e teste cross-tenant; skills new-migration / new-endpoint /',
  '  tenant-isolation-test; feche a onda com a skill verify e atualize NOTES.md.',
);

process.stdout.write(`${out.join('\n')}\n`);
process.exit(0);
