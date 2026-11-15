---
name: new-endpoint
description: Implementa um endpoint da API contract-first, como vertical slice (contrato → schema Zod → use case → handler → route.ts → testes), com a ordem fixa de segurança do projeto. Use ao criar ou alterar qualquer rota em src/app/api/v1.
argument-hint: "<operationId do contracts/openapi.v1.yaml>"
---

# Novo endpoint: $ARGUMENTS

## 1. Contrato primeiro

1. Encontre `operationId: $ARGUMENTS` em `contracts/openapi.v1.yaml`. Anote `x-wave`, `x-roles`,
   os schemas de entrada e saída e as respostas de erro listadas.
2. Se a operação não existir ou precisar mudar: **edite o contrato antes do código** (e a tabela
   da spec §8). Mudança de comportamento → confirme com o usuário. Mudança incompatível → nova versão.
3. Confira na spec o RF correspondente e seus critérios de aceite: eles viram os nomes dos testes.

## 2. Onde mora

- Módulo (bounded context): `identity`, `clients`, `tracking` ou `audit`.
- Pasta da feature: `src/modules/<modulo>/features/<operation-em-kebab>/`
  (ex.: `completeStage` → `complete-stage/`).
- Route: `src/app/api/v1/<path com [param]>/route.ts`.

## 3. Arquivos da slice

| Arquivo | Camada | Regras |
|---|---|---|
| `<slice>.schema.ts` | presentation | Zod de params, query e body espelhando o contrato: `z.uuid()`, `min`/`max`, enums, `.nullable()`, `.strict()` em todo objeto. Rejeite caracteres de controle em textos. |
| `<slice>.use-case.ts` | application | Recebe a sessão (`userId`, `role`, `clientId`) e o input validado. Orquestra domínio e portas. Recurso fora do tenant → `NotFoundError`. Sem nada de HTTP. |
| `<slice>.use-case.test.ts` | teste | Escreva **antes** do use case. Repositórios fake. Um teste por CA (`RF-xx.CAy`). |
| `<slice>.handler.ts` | presentation | Fino: usa o wrapper de rota de `src/shared/http` (criado na Onda 0), declara papel, rate limit e schemas, chama o use case e mapeia a resposta. |
| `route.ts` | Next.js | **Só** `export { POST } from '@/modules/…/<slice>.handler';` |

Esboço do handler (a API exata do wrapper é definida na Onda 0; atualize este esboço quando ela existir):

```ts
// src/modules/tracking/features/complete-stage/complete-stage.handler.ts
import { defineRoute } from '@/shared/http/define-route';
import { completeStageParams } from './complete-stage.schema';
import { completeStage } from './complete-stage.use-case';
import { toAdminProjectDetail } from '../../infrastructure/project.mapper';

export const POST = defineRoute(
  {
    auth: { roles: ['ceo'] },     // vem de x-roles; 'public' só se o contrato tiver security: []
    rateLimit: 'mutation',
    params: completeStageParams,  // ordem garantida pelo wrapper: rate limit → auth → gate de senha → papel → Zod
  },
  async ({ params, session, deps }) => {
    const project = await completeStage(deps, { session, stageId: params.stageId, projectId: params.projectId });
    return { status: 200, body: toAdminProjectDetail(project) };
  },
);
```

## 4. Infraestrutura

- Leitura e escrita simples: supabase-js via `createUserClient()` (a RLS se aplica).
- Escrita multi-linha ou com invariante: função `tracking_*` via `.rpc()` (crie com a skill `new-migration`).
- `createAdminClient()` **só** para Auth Admin e funções `admin_*`, depois da authz no use case.
- **Nunca** interpole input em `.or()`, `.filter()`, `.not()` ou `.textSearch()`. Use `.eq/.in/.ilike` com valor validado.
- Mapper de resposta com **allowlist explícita** de campos (nunca `...row`). DTO de portal só com campos `Portal*`.
- Traduza os erros do Postgres (`P0001` + `message`, `42501`, `23505`) para erros de domínio no repositório.

## 5. Testes obrigatórios

- **Unidade:** use case (todos os CA) e regras de domínio novas.
- **Integração** (`tests/integration/<area>/`): caminho feliz + cada 4xx listado no contrato,
  com a resposta validada contra o schema do OpenAPI.
- **Segurança** (skill `tenant-isolation-test`):
  - Cross-tenant → 404 e papel errado → 403.
  - Campos extras → 400 (SEC-06).
  - Corpus de SQLi nos campos string (SEC-04).
  - Mutação sem `Origin` válido → 403.
  - A mutação gera o evento de auditoria esperado (SEC-14).

## 6. Fechar

```bash
npm run verify
```

Depois, peça revisão aos agents `api-contract-guardian` e `owasp-reviewer` e corrija o que for
ALTO ou CRÍTICO.
