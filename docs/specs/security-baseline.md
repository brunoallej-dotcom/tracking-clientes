# Spec — Baseline de segurança

> **Status:** Draft v1 · **Data:** 2026-11-15 · Complementa
> [`client-delivery-tracking.md`](client-delivery-tracking.md). Todo controle aqui é requisito
> (RNF-01) e tem uma verificação associada. Revise este documento sempre que a superfície de
> ataque mudar: rota nova, integração nova, papel novo, dado novo.

---

## 1. Ativos e o que proteger

| Ativo | Por que importa | Pior caso |
|---|---|---|
| Rastreamento dos projetos de cada cliente | Confidencialidade comercial entre clientes | Cliente A vê projetos do cliente B (vazamento cross-tenant). |
| Contas de CEO | Controle total do sistema | Conta tomada avança, apaga ou altera fluxos; cria logins. |
| Contas de clientes | Acesso aos dados do próprio cliente | Acesso indevido aos projetos de um cliente. |
| Dados pessoais (nome, e-mail) | LGPD | Incidente reportável à ANPD. |
| Secret key do Supabase | Ignora a RLS | Acesso total ao banco. |
| Trilha de auditoria | Não repúdio | Ação sem autor ou trilha adulterada. |

## 2. Fronteiras de confiança

```
[Navegador] ──(1) HTTPS + cookie HttpOnly──▶ [Vercel / Next.js] ──(2) HTTPS + JWT do usuário──▶ [Supabase PostgREST/Auth] ──▶ [Postgres + RLS]
                                                     │
                                                     └──(3) HTTPS + secret key (só Auth Admin / admin_*)──▶ [Supabase]
[Internet] ──(4) publishable key (se descoberta)──▶ [Supabase PostgREST]   ← caminho que não passa pela nossa API
```

O caminho (4) existe por natureza do Supabase. Por isso a RLS e os grants precisam se
sustentar sozinhos, sem a nossa API na frente.

## 3. Threat model (STRIDE)

| # | Categoria | Ameaça | Mitigação | Verificação |
|---|---|---|---|---|
| T1 | **S**poofing | Força bruta ou credential stuffing no login | Rate limit por (IP, e-mail) e por IP; limites do Supabase Auth; senha ≥ 12 com blocklist; erro genérico; MFA para CEO (Q3) | SEC-07, SEC-13 |
| T2 | Spoofing | Roubo de sessão por XSS | Cookies `HttpOnly; Secure; SameSite=Lax`; navegador sem SDK Supabase; CSP; dados renderizados como texto | SEC-08, SEC-10 |
| T3 | Spoofing | Conta criada por signup aberto | `enable_signup = false`; sem perfil a RLS nega tudo | SEC-15, pgTAP |
| T4 | **T**ampering | Cliente altera dados via PostgREST direto | Policies de escrita só para CEO; grants mínimos por coluna; tabelas do fluxo sem grant de escrita; funções checam `assert_ceo()` | SEC-02 |
| T5 | Tampering | SQL injection | Ver §4 | SEC-04, SEC-05 |
| T6 | Tampering | Mass assignment (`role`, `clientId`, `completedAt` no body) | Zod `.strict()`; grants por coluna; status só via funções | SEC-06 |
| T7 | Tampering | CSRF em mutações com cookie | `SameSite=Lax` + checagem de `Origin` no proxy + JSON obrigatório | SEC-09 |
| T8 | Tampering | Fluxo avançado fora de ordem ou em corrida | Invariantes no domínio + função com `FOR UPDATE` | pgTAP, RF-25.CA2 |
| T9 | **R**epudiation | CEO nega ter concluído uma fase | `audit_events` append-only, gravado na mesma transação | SEC-14 |
| T10 | **I**nformation disclosure | IDOR / acesso cross-tenant | Tenant vem do perfil; RLS; 404 para recurso alheio | SEC-01, SEC-02 |
| T11 | Information disclosure | Campos internos vazam no portal | Tabelas separadas por audiência + allowlist no DTO | RF-31.CA2 |
| T12 | Information disclosure | Erros revelam SQL, stack ou se um e-mail existe | Problem+json genérico; erro de login genérico | SEC-11 |
| T13 | Information disclosure | Secret key exposta no bundle ou no repositório | Sem `NEXT_PUBLIC_`; `import 'server-only'`; gitleaks; hook de pre-write | SEC-12 |
| T14 | Information disclosure | PII em logs | Redação no pino; só IDs internos | SEC-13 |
| T15 | **D**enial of service | Flood em login ou nas rotas | Rate limit; Vercel Firewall; corpo ≤ 16 KB; paginação ≤ 100 | SEC-07 |
| T16 | **E**levation of privilege | Cliente vira CEO | `role` só no `app_metadata` (secret key) e no `profiles` (sem grant); CEO só por script | pgTAP, SEC-06 |
| T17 | Elevation of privilege | Função `security definer` mal escrita | `search_path = ''`; `assert_ceo()` na 1ª linha; `revoke` de `public/anon`; agent `rls-auditor` | pgTAP, revisão |
| T18 | Elevation of privilege | Autorização feita só no proxy (CVE-2025-29927) | Authz sempre no handler e na RLS; o proxy não decide acesso | Revisão, SEC-01 |

## 4. SQL injection — controles específicos

1. **Sem SQL dinâmico na aplicação.** O acesso a dados é só por supabase-js (PostgREST
   parametriza tudo) e `.rpc()` com parâmetros nomeados. Proibido montar SQL com template
   string ou concatenação.
2. **Injeção de filtro PostgREST.** `.or()`, `.filter()`, `.not()` e `.textSearch()` recebem
   strings com sintaxe própria. **Nunca interpole input nelas.** Use os métodos tipados
   (`.eq()`, `.in()`, `.ilike()`) com valores validados. Para busca textual, escape `%`, `_` e
   `\` e passe o padrão como valor de `.ilike('name', pattern)`.
3. **Enums e IDs validados antes da query.** `status` só aceita os valores do enum (Zod), IDs
   só UUID e `limit` só inteiro de 1 a 100. Valor fora disso → `400` antes de tocar o banco.
4. **Ordenação por allowlist.** Ordenação nunca vem crua do cliente: o servidor mapeia um
   valor de enum para uma coluna fixa.
5. **PL/pgSQL sem `EXECUTE` dinâmico.** As funções usam só SQL estático com parâmetros. Se
   algum dia for inevitável, use `format()` com `%I`/`%L`, com revisão obrigatória do agent
   `rls-auditor`.
6. **`search_path` fixo.** Toda função usa `set search_path = ''` e nomes qualificados
   (`public.projects`), o que evita sequestro de objetos por schema.
7. **Menor privilégio no banco.** Mesmo uma injeção bem-sucedida rodaria como `authenticated`
   sob RLS, nunca como dono.
8. **Verificação.** Corpus de payloads (SEC-04) em todo campo string e query param; hook
   `security-lint` e Semgrep sinalizam `.or(\`…${…}\`)`, `EXECUTE` e `security definer` sem
   `search_path`.

## 5. OWASP Top 10:2025 → controles

| Categoria | Controles neste projeto | Verificação |
|---|---|---|
| **A01 Broken Access Control** (inclui SSRF) | Deny by default; ordem auth → authz → validação; tenant do perfil; RLS forçada em toda tabela; 404 para recurso alheio; grants por coluna; CEO só por script; o backend não faz fetch de URL vinda do usuário (sem SSRF) | SEC-01, SEC-02, SEC-03, pgTAP |
| **A02 Security Misconfiguration** | `config.toml` endurecido (signup off, JWT 15 min, GraphQL fora de `api.schemas`); headers de segurança; sem CORS; `poweredByHeader: false`; Preview da Vercel aponta para staging, nunca para produção; paridade via `supabase config push` | SEC-08, revisão de config |
| **A03 Software Supply Chain Failures** | `package-lock.json` versionado + `npm ci`; versões exatas (`save-exact`); Dependabot/Renovate; `npm audit` + osv-scanner no CI; Actions pinadas por SHA com `permissions` mínimas; MCPs e skills revisados | CI |
| **A04 Cryptographic Failures** | TLS em tudo (HSTS); senhas com bcrypt pelo Supabase Auth; criptografia em repouso pelo Supabase; chaves de rate limit com HMAC + pepper; senhas temporárias geradas com `crypto.randomBytes` | SEC-08, revisão |
| **A05 Injection** | §4 (SQLi e filtro PostgREST); dados devolvidos como JSON com `nosniff`; o frontend renderiza texto (sem `dangerouslySetInnerHTML`) | SEC-04, SEC-05 |
| **A06 Insecure Design** | Spec + threat model antes do código; invariantes no domínio e no banco; tabelas separadas por audiência; limites (50 fases, 16 KB, paginação) | Revisão de spec, pgTAP |
| **A07 Authentication Failures** | Signup off; política de senha (12–128 + blocklist + proteção de senha vazada do Supabase quando o plano permitir); troca obrigatória no 1º login; rate limit; sessões revogadas no reset e na desativação; MFA para CEO (Q3) | SEC-07, SEC-10, SEC-13, SEC-15 |
| **A08 Software or Data Integrity Failures** | Migrations só via CI e imutáveis após o merge; deploy só com CI verde; branch `main` protegida; auditoria append-only; sem scripts de terceiros em runtime | Hook `guard-sensitive-files`, CI |
| **A09 Logging & Alerting Failures** | Logs JSON com `requestId`; auditoria de toda mutação e de login; alertas para picos de `auth.login_failed`, `RATE_LIMITED`, `FORBIDDEN` de usuário autenticado e 5xx | SEC-14, Onda 12 |
| **A10 Mishandling of Exceptional Conditions** | Fail closed em auth e rate limit de login; timeout de 10 s nas chamadas ao Supabase; transações atômicas; erro inesperado → `500` genérico; nada de `catch` que engole erro | SEC-11, E27–E29 |

## 6. Autenticação e sessão

- **Provedor:** Supabase Auth, só e-mail + senha. `enable_signup = false` no `config.toml` e no
  projeto remoto.
- **Criação de contas:** clientes pelo endpoint de CEO (RF-13); CEOs só pelo script de bootstrap
  (RF-05). O papel e o cliente vão em `app_metadata`, que o usuário não consegue alterar.
- **Senha:** 12 a 128 caracteres, sem regras de composição (NIST SP 800-63B), checada contra
  uma blocklist de senhas comuns. Senha temporária: troca obrigatória no 1º login.
- **Sessão:** JWT de 15 min + refresh token rotativo (`refresh_token_reuse_interval = 10`).
  Cookies `HttpOnly; Secure; SameSite=Lax; Path=/`.
- **Validação da sessão:** `auth.getUser()` em toda requisição autenticada. `getSession()`
  nunca é usado para decidir acesso.
- **Revogação:** logout revoga a sessão atual. Reset de senha, troca de senha e desativação
  revogam todas as sessões (`admin_revoke_user_sessions`). Desativação também faz ban no Auth
  e a RLS checa `is_active`.
- **MFA (Q3, Onda 12 se aprovado):** TOTP do Supabase para CEOs; rotas `/admin/*` e policies de
  CEO passam a exigir `aal2`.
- **Rate limits:**

| Rota | Limite | Chave |
|---|---|---|
| `POST /auth/login` | 5 / 15 min e 20 / 15 min | HMAC(IP + e-mail) e HMAC(IP) |
| `POST /auth/password` | 5 / 15 min | userId |
| Mutações autenticadas | 60 / min | userId |
| Leituras autenticadas | 300 / min | userId |
| `GET /health` | 60 / min | HMAC(IP) |

O IP vem só dos headers que a Vercel define (`x-forwarded-for`, via `@vercel/functions`
`ipAddress()`); valores enviados pelo cliente nunca são confiáveis.

## 7. Autorização e isolamento multi-tenant

- Duas barreiras independentes: (1) o use case filtra pelo `client_id` do perfil e checa o
  papel; (2) a RLS repete a regra no banco. Qualquer uma sozinha precisa impedir o vazamento.
- Toda tabela em `public` tem `enable` + `force row level security` e policies explícitas por
  operação. Tabela sem policy = ninguém acessa (é o que se quer por padrão).
- Dados internos ficam em tabelas separadas, só para CEO (`project_internal_notes`,
  `audit_events`). Nunca coluna interna em tabela legível pelo cliente.
- Recurso de outro tenant → `404`. Rota de papel errado → `403`.

## 8. Headers, CORS, CSRF e cookies

Toda resposta `/api/*` traz:

| Header | Valor |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` (na API). As páginas da fase 2 usam CSP com nonce. |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Cache-Control` | `no-store` |
| `X-Request-Id` | id de correlação |

- **CORS:** nenhum `Access-Control-Allow-Origin` (só mesma origem).
- **CSRF:** mutações exigem `Origin` igual a `APP_URL` (ausente ou diferente → `403 ORIGIN_NOT_ALLOWED`)
  e `Content-Type: application/json`. Somado a `SameSite=Lax`, isso fecha o CSRF clássico.
- **`X-Powered-By`:** desligado (`poweredByHeader: false`).

## 9. Segredos e configuração

- Segredos só em variáveis de ambiente (Vercel por ambiente; `.env.local` no desenvolvimento,
  fora do git). O `.env.example` só tem placeholders.
- `SUPABASE_SECRET_KEY` é server-only: lida apenas em `src/shared/infrastructure/env.ts` e
  usada apenas em `admin-client.ts` (que importa `server-only`). Nunca com prefixo `NEXT_PUBLIC_`.
- Ambientes: Development = Supabase local; Preview = projeto Supabase de **staging**;
  Production = projeto de produção. Preview nunca aponta para produção.
- Rotação: o Supabase permite várias secret keys ao mesmo tempo. Gere uma nova, atualize a
  Vercel, faça o redeploy e revogue a antiga (runbook na Onda 12).
- O MCP do Supabase só é usado contra o banco local ou o staging em modo `read_only`.
  **Nunca contra produção.**

## 10. Logs, auditoria e alertas

- **Logger:** pino em JSON, nível por `LOG_LEVEL`. Campos: `time`, `level`, `msg`, `requestId`,
  `userId`, `role`, `route`, `method`, `status`, `durationMs`.
- **Redação obrigatória:** `req.headers.cookie`, `req.headers.authorization`, `*.password`,
  `*.currentPassword`, `*.newPassword`, `*.temporaryPassword`, `*.email`, `*.token`.
- **Proibido:** `console.log` em `src/` fora de testes.
- **Auditoria:** toda mutação grava `audit_events` (quem, ação, entidade, cliente, projeto,
  `requestId`) sem PII em `metadata`. Login com sucesso também é auditado; falhas vão só para o log.
- **Alertas (Onda 12):** log drain da Vercel com alertas para (a) mais de 20 `auth.login_failed`
  em 5 min, (b) taxa de 5xx acima de 1%, (c) `FORBIDDEN`/`NOT_FOUND` em sequência vindos do
  mesmo usuário (sondagem de IDOR).

## 11. Supply chain e CI (Onda 0)

- Workflow `ci.yml`: `npm ci` → lint → typecheck → testes unitários → `supabase start` →
  `db:lint` → `db:test` → testes de integração e segurança → `contract:lint` → build.
- Scans: gitleaks (segredos), Semgrep (`p/owasp-top-ten`, `p/typescript`, `p/react`,
  `p/secrets`), `npm audit --audit-level=high`, osv-scanner.
- Actions pinadas por commit SHA; `permissions: contents: read` por padrão.
- Dependências novas exigem justificativa no PR.

## 12. Tratamento de erros e condições excepcionais

- Um mapeador central de erros: erro de domínio → código do catálogo; erro de PostgREST/Postgres
  conhecido → código do catálogo; qualquer outro → `500 INTERNAL_ERROR`.
- O detalhe interno (mensagem do Postgres, stack) vai só para o log, com o `requestId`.
- Toda chamada de saída tem timeout de 10 s (`AbortSignal.timeout`).
- Falha do armazenamento de rate limit no login → fail closed (`503`).
- Nenhuma operação deixa estado parcial: mutações multi-linha são funções transacionais.

## 13. LGPD

| Dado | Titular | Finalidade | Base legal | Retenção | Onde |
|---|---|---|---|---|---|
| Nome e e-mail do usuário do cliente | Funcionário do cliente | Acesso ao rastreamento | Execução de contrato (art. 7º, V) | Enquanto houver contrato + 6 meses; depois, anonimização | Supabase `sa-east-1` |
| Nome e e-mail dos CEOs | CEO | Operação do sistema | Execução de contrato / legítimo interesse | Enquanto durar o vínculo | Supabase `sa-east-1` |
| HMAC de IP (rate limit) | Qualquer visitante | Segurança | Legítimo interesse (art. 7º, IX) | Até 24 h (expurgo) | Supabase `sa-east-1` |
| Logs de aplicação (só IDs internos) | — | Operação e segurança | Legítimo interesse | Conforme o plano da Vercel ou o log drain (proposta: 90 dias) | Vercel |
| Eventos de auditoria (só IDs) | Usuários | Não repúdio | Legítimo interesse / obrigação contratual | 5 anos (Q9, validar com o jurídico) | Supabase `sa-east-1` |

- **Direitos do titular:** pedidos de acesso e correção são atendidos por um CEO. Exclusão =
  apagar o usuário do Auth (o e-mail some) e anonimizar o perfil
  (`full_name = 'Usuário removido'`); a auditoria guarda só o UUID. Runbook na Onda 12.
- **Operadores:** Supabase (AWS `sa-east-1`) e Vercel (funções em `gru1`; logs e edge podem ser
  processados fora do Brasil, o que deve ser registrado no aviso de privacidade).
- **Criptografia:** TLS 1.2+ em trânsito; AES-256 em repouso (gerenciado pelo Supabase).

## 14. Testes de segurança obrigatórios

| ID | Teste | Onda |
|---|---|---|
| SEC-01 | Matriz de IDOR: todo endpoint com ID × todo papel × recurso de outro tenant → `404`; cliente em `/admin/*` → `403`. | 4–9 (por slice), consolidado na 12 |
| SEC-02 | RLS direta: com o JWT de um cliente no supabase-js, só as próprias linhas no SELECT; INSERT e DELETE → erro (`42501`); UPDATE não altera nenhuma linha; `rpc('tracking_*')` → `42501`. | 1 |
| SEC-03 | `anon`: publishable key sem JWT → zero acesso a toda tabela e toda função. | 1 |
| SEC-04 | Corpus de SQLi em todo campo string e query param: gravado literalmente, sem `500`, sem linhas extras. | 4–9, consolidado na 12 |
| SEC-05 | Injeção de filtro PostgREST em query params (ex.: `status=active,client_id.neq.x`) → `400`. | 5–9 |
| SEC-06 | Mass assignment: `role`, `clientId`, `status`, `completedAt`, `authorId` extras no body → `400`. | 4–9 |
| SEC-07 | Rate limit: 6ª tentativa de login → `429` com `Retry-After`; troca de senha idem. | 3 |
| SEC-08 | Todas as respostas `/api/*` com os headers da §8 e sem `X-Powered-By`. | 0 |
| SEC-09 | Mutação com `Origin` estranho ou sem `Origin` → `403`. | 0 |
| SEC-10 | Flags do cookie; logout revoga o refresh token; usuário desativado com JWT válido → `401` na hora. | 3–4 |
| SEC-11 | Erro forçado de banco → `500` problem+json sem SQL nem stack; JSON inválido → `400`. | 0 |
| SEC-12 | gitleaks limpo; `SUPABASE_SECRET_KEY` referenciada só nos arquivos permitidos (grep no CI). | 0 |
| SEC-13 | Política de senha; senha temporária e e-mail ausentes dos logs (teste capturando o log). | 3–4 |
| SEC-14 | Toda mutação gera exatamente o evento de auditoria esperado; UPDATE/DELETE em `audit_events` rejeitados. | 2, 4–9 |
| SEC-15 | `auth.signUp` → erro (signup desabilitado). | 3 |

## 15. Riscos aceitos

| Risco | Por que é aceito | Mitigação parcial |
|---|---|---|
| O PostgREST é alcançável direto com a publishable key, se ela for descoberta | Natureza do Supabase | RLS + grants mínimos + funções com `assert_ceo()`; a publishable key não vai para o navegador. |
| O rate limit da API não cobre o caminho direto ao PostgREST | Idem | Signup off; sem escrita para clientes; limites nativos do Supabase Auth. |
| Um JWT de acesso continua válido por até 15 min depois de um reset de senha | Custo de checar a sessão a cada query | Sessões revogadas (o refresh falha); a desativação é imediata pela RLS. |
| Sem WAF dedicado no plano Hobby da Vercel | Custo | Vercel Firewall no plano Pro (recomendado para produção). |

### Fundação implementada (Onda 0)

O health público retorna somente status de liveness. SEC-08/09/11 cobrem headers, CSRF e erros;
o smoke também passa pelo servidor Next real. O proxy correlaciona, verifica Origin e renova
cookies; a autorização fica no handler. O wrapper repete Origin como defesa em profundidade.
IDs externos são limitados a 64 caracteres alfanuméricos, hífen e sublinhado; os demais são
substituídos. O JSON tem limite em bytes inclusive sem Content-Length. Logs usam códigos do
catálogo sem copiar mensagens externas que podem conter PII.

O adapter Postgres do rate limit é conectado na Onda 3, depois da função da Onda 2. Nesta
fundação o health segue fail-open de E27 com registro da indisponibilidade. Acesso privado
sem adapter de identidade permanece negado. Não há tabelas públicas nem mutações novas.
