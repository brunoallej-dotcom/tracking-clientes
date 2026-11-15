# Ambiente local

Use Node 24 (`nvm use`), npm e Docker com o daemon em execução.
A CLI Supabase 3.1.0 está fixada no lockfile; não precisa de instalação global.

1. Execute `npm ci` e `npx supabase start` (a primeira execução baixa imagens Docker).
2. Configure as variáveis locais conforme o arquivo de exemplo da raiz e os valores de
   `npx supabase status`. Nunca versione credenciais. As chaves Supabase são server-only.
3. Configure `APP_URL=http://localhost:3000` e gere `RATE_LIMIT_PEPPER` com `openssl rand -base64 32`.
4. Execute `npm run dev`. A fase 1 oferece a API, sem painel web.
5. Confira `curl -i http://localhost:3000/api/v1/health`: `200 {"status":"ok"}` e os headers da baseline.

Cookies sempre usam `HttpOnly; Secure; SameSite=Lax; Path=/`. Para testar sessões localmente,
use localhost ou HTTPS local. A origem enviada nas mutações precisa ser exatamente a de `APP_URL`.

## Verificação

Com Supabase rodando, `npm run verify` executa lint, tipos, unidade, integração, segurança,
banco (lint e pgTAP), geração de tipos, contrato e build. A CLI 3 usa o banco local por padrão;
não passe `--local` aos subcomandos `db lint` e `gen types`.
`npm run db:types` grava o arquivo só depois de a geração terminar com sucesso.
Depois do build, `node scripts/smoke-foundation.mjs` testa health, headers e CSRF pelo servidor
real em `127.0.0.1:3100`; aguarda Ready e fecha o processo ao terminar, sem criar rotas de teste.
`npm run format` formata o scaffold, preservando a documentação e o contrato existentes.
`npx supabase stop` encerra a stack preservando volumes. Não use comandos remotos no setup local.

## Limites da onda

A fundação entrega a porta de rate limit e o pipeline de guards testados com adapters fake.
O adapter Postgres depende da função da Onda 2 e é conectado na Onda 3. Até lá o health segue
fail-open, registrando `rate_limit.unavailable`, conforme E27. Rotas privadas sem adapter de
identidade permanecem negadas. O health não exige banco nem credenciais.
O refresh usa `auth.getUser()` com timeout de 10 s e não faz autorização. O seed fica desativado
até a Onda 1 criar seus dados fictícios e ativá-lo.

## Dependências

Versões exatas e lockfile: Next/React/React DOM para o runtime de Route Handlers; Supabase JS/SSR
para refresh server-side; Zod nas fronteiras; pino para logs; `server-only` para impedir import
no cliente. TypeScript e tipos Node/React suportam compilação strict; ESLint/config Next/Prettier
verificam qualidade; Vitest executa testes; Redocly valida OpenAPI; Supabase CLI gerencia a stack
local. Tailwind e Playwright ficam para a fase 2.

A CI executa gates e smoke, gitleaks, Semgrep, npm audit e OSV. Actions fixadas por SHA e scanners
por versão, token GitHub de leitura. O resultado remoto só pode ser confirmado após push/PR.

O override de `minimatch` 11.0.8 no parser TypeScript do ESLint corrige
GHSA-g3hv-75wg-m249 sem alterar as dependências de runtime. ESLint 9.39.5 mantém
compatibilidade com os peers dos plugins Next. Scanners binários têm checksum SHA-256 fixado.
