# Architecture Decision Records

Formato Michael Nygard (Contexto / Decisão / Consequências), numeração sequencial e status
`proposed` → `accepted` → `superseded by ADR-XXXX`. Um ADR `accepted` não é editado: decisão
nova = ADR novo que o substitui.

| # | Título | Status |
|---|---|---|
| [0001](0001-stack.md) | Stack: Next.js + Supabase + Vercel, sem ORM e sem backend separado | accepted |
| [0002](0002-tenant-isolation.md) | Isolamento multi-tenant e separação por audiência | accepted |
| [0003](0003-flow-commands-in-postgres.md) | Comandos do fluxo como funções Postgres, com dupla checagem no domínio | accepted |
| [0004](0004-rate-limiting.md) | Rate limiting em Postgres + Vercel Firewall | proposed |
