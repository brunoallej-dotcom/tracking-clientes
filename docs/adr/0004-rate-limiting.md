# ADR-0004 — Rate limiting em Postgres + Vercel Firewall

- **Status:** proposed (aguarda confirmação: spec Q10)
- **Data:** 2026-11-15

## Contexto

O login e a troca de senha precisam de limite por IP e por identidade (OWASP A07), e as rotas
autenticadas precisam de quota por usuário. Funções serverless da Vercel não compartilham
memória, então um limitador em memória não funciona em produção. O volume esperado é baixo.

## Decisão

- **Contadores em Postgres** (`private.rate_limit_counters`, janela fixa) acessados pela função
  `public.rate_limit_hit(p_key, p_limit, p_window_seconds)`, executável só por `service_role`.
  O upsert é atômico (`insert … on conflict … do update … returning`).
- **Chaves pseudonimizadas:** `HMAC-SHA256(RATE_LIMIT_PEPPER, escopo || identificador)`. O IP
  nunca é gravado em claro (LGPD). Expurgo de janelas com mais de 24 h (`pg_cron` ou limpeza
  oportunista na própria função).
- **Política de falha:** login e troca de senha falham fechado (`503`); as outras rotas falham
  aberto e logam `error`.
- **Camada externa:** regras do Vercel Firewall (rate limit por IP e bot protection) contra
  volume, quando o plano permitir.
- **Adapter atrás de uma porta** (`RateLimiter` em `src/shared/infrastructure/rate-limit`),
  para trocar a implementação sem tocar nos handlers.

## Alternativas consideradas

- **Upstash Redis (`@upstash/ratelimit`):** feito para isso e melhor sob ataque volumétrico,
  mas é mais um fornecedor, mais um operador de dados (LGPD) e mais um segredo. Fica como
  plano B (troca do adapter) se a carga justificar.
- **Em memória:** não funciona em serverless.
- **Só Vercel Firewall:** depende do plano e não faz chave por usuário ou e-mail.

## Consequências

- (+) Mantém a stack em Vercel + Supabase, com paridade total entre local e produção.
- (−) Uma escrita no banco por requisição limitada. Aceitável no volume previsto; reavaliar se
  o p95 do RNF-03 for afetado.
- (−) Sob flood, o banco absorve a carga. Por isso a camada do Vercel Firewall é recomendada
  em produção.
