# Plano: organização por domínios, erros e testes

Branch: `refactor/domains-and-errors` (a `main` não é tocada).

**Status: concluído.** 219 testes passando, build e typecheck limpos.

Decisões já tomadas:

- Formato de erro **compatível com o front** (`error` continua string; entram `code`, `details`, `requestId`).
- **422** para regra do jogo recusada; **409** só para "já está nesse estado". O front só depende de 401 e de `body.error`, então é seguro.
- Layout por domínio no mesmo padrão do `yooga-club` (pastas por camada), com camada de **repositories**.
- **Testes** entram no mesmo trabalho (Vitest + supertest).

## 1. Estrutura final

```
src/
  app.ts · server.ts · config.ts
  shared/
    errors/AppError.ts           # AppError + subclasses HTTP
    http/                        # errorHandler, validate, asyncHandler, notFound, requestId, rateLimit
    database/prisma.ts
  modules/
    auth/
      controllers/auth.controller.ts
      dto/auth.dto.ts                    # schemas zod + tipos inferidos
      entities/session.ts
      repositories/                      # único lugar que fala com o Prisma
        user.repository.ts
        session.repository.ts
        password-reset.repository.ts
      services/auth.service.ts
      middlewares/require-auth.ts
      utils/                             # cookies, password (scrypt), mailer, tokens
      auth.module.ts                     # monta o Router
    users/
      controllers/ · dto/ · enums/avatar.enum.ts · entities/public-user.ts
      repositories/ · services/ · users.module.ts
    game/
      controllers/game.controller.ts
      dto/game.dto.ts
      entities/game-state.ts
      repositories/game.repository.ts    # act() com FOR UPDATE, plots, itens, dinheiro, catálogo
      services/                          # game-actions, game-state, catalog
      utils/game.constants.ts
      game.module.ts
    health/health.module.ts
tests/
  unit/                                  # sem banco
  integration/                           # supertest + banco de teste
  helpers/                               # criar usuário logado, limpar dados, etc.
```

### Responsabilidade de cada camada

| Camada                 | Faz                                                                     | Não faz                         |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------- |
| `*.module.ts`          | URL → middlewares (`requireAuth`, `rateLimit`, `validate`) → controller | lógica                          |
| `controllers/`         | lê `req`, chama o service, monta a resposta (status, cookie, JSON)      | conhece Prisma ou regra do jogo |
| `services/`            | regra de negócio; lança `AppError`                                      | importa Express ou Prisma       |
| `repositories/`        | consultas e escritas no Prisma                                          | regra de negócio                |
| `dto/`                 | schemas de entrada (zod) e tipos                                        | —                               |
| `entities/` · `enums/` | tipos do domínio, constantes                                            | —                               |

URLs **não mudam**: `PATCH /auth/me` continua em `/auth/me`, só que o código dele vive no módulo `users`.

## 2. Erros

`AppError(status, code, message, details?, headers?)` é a base.

| Classe                 | Status | Uso                                                                              |
| ---------------------- | ------ | -------------------------------------------------------------------------------- |
| `BadRequestError`      | 400    | input inválido, referência inexistente (planta/item), código de reset errado     |
| `UnauthorizedError`    | 401    | sem sessão, sessão expirada, login errado                                        |
| `ForbiddenError`       | 403    | reservado                                                                        |
| `NotFoundError`        | 404    | terreno, árvore, save, rota                                                      |
| `ConflictError`        | 409    | e-mail já cadastrado, tile já arado, terreno já é seu                            |
| `UnprocessableError`   | 422    | sem dinheiro, sem semente, planta verde, árvore sem fruta, terreno não adjacente |
| `TooManyRequestsError` | 429    | rate limit (com `Retry-After`)                                                   |

O `errorHandler` único traduz também o que não é `AppError`:

| Origem                                                      | Resultado                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| `ZodError`                                                  | 400 `VALIDATION_ERROR` + `details: [{ path, message }]`         |
| JSON malformado                                             | 400 `INVALID_JSON` (hoje dá 500)                                |
| Body > 100kb                                                | 413 `PAYLOAD_TOO_LARGE`                                         |
| Prisma `P2002` / `P2003`                                    | 409                                                             |
| Prisma `P2025`                                              | 404                                                             |
| Prisma `P2034`, `P2024`, `P1008`, `P1001`, `P1002`, `P1017` | 503 + `Retry-After`                                             |
| `PrismaClientInitializationError`                           | 503 `DATABASE_UNAVAILABLE`                                      |
| Rota inexistente                                            | 404 JSON (hoje é HTML)                                          |
| Qualquer outra coisa                                        | 500 `INTERNAL_ERROR` genérico; stack só no log, com `requestId` |

Resposta de erro: `{ "error": "msg", "code": "CODE", "details": [...], "requestId": "..." }`.

Complementos: `asyncHandler` (sem `try/catch` nos controllers), `validate({ body, params, query, message })`
(valida também `:treeId`), cookie de sessão inválida limpo no 401, shutdown gracioso em SIGTERM/SIGINT.

## 3. Como trabalhar (para não embolar)

Regras:

1. **Um módulo por vez**, na ordem: `users` → `auth` → `game` → `health`. Não começo o seguinte antes de o atual passar no checkpoint.
2. Cada módulo é escrito do zero na estrutura nova; o código antigo serve só de fonte da lógica.
3. **Checkpoint de cada fase:** `tsc --noEmit` limpo, roteiro de smoke sem diferença inesperada contra o baseline,
   testes do módulo passando, e então um commit.
4. Antes de começar: cópia do estado atual fora do repo (rede de segurança).

Estado:

| Fase | Conteúdo                                                                                           | Estado |
| ---- | -------------------------------------------------------------------------------------------------- | ------ |
| 0    | baseline do comportamento atual (roteiro de smoke)                                                 | feito  |
| 1    | `shared/` (erros, http, database) + `app.ts`                                                       | feito  |
| 2    | testes: infraestrutura + unitários do `shared/`                                                    | feito  |
| 3–5  | módulos `users` + `auth` + `game` (feitos juntos: `users` depende do `requireAuth`) + testes deles | feito  |
| 6    | `health`, remoção do código antigo, README, PROGRESS.md                                            | feito  |

## 4. Testes (Vitest + supertest)

### Infraestrutura (fase 2)

- Dependências de desenvolvimento: `vitest`, `supertest`, `@types/supertest`.
- Scripts: `test`, `test:unit`, `test:int`, `test:watch`.
- `vitest.config.ts` com `globalSetup` que cria o banco **`deadharvest_test`** no mesmo Postgres do Docker, aplica
  `prisma migrate deploy` nele e define `DATABASE_URL` só para os testes. **O banco de desenvolvimento nunca é usado.**
- Testes de integração rodam em sequência (um banco compartilhado); usuários de teste têm e-mail único e são
  apagados no fim (o `ON DELETE CASCADE` leva save, terrenos e inventário).
- `tsconfig.test.json` para checar tipos dos testes com `tsc --noEmit`. `tests/` fica fora do build.

### Unitários (sem banco)

| Alvo                                 | O que verifica                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `errorHandler`                       | uma linha por linha da tabela da seção 2, incluindo que o 500 não vaza a mensagem interna                           |
| `validate`                           | troca o body pelo valor tratado; erro vira 400 com `details`; `message` customizada                                 |
| `asyncHandler`                       | rejeição de promise chega no `errorHandler`                                                                         |
| `rateLimit`                          | 429 + `Retry-After`; janela reinicia (timers falsos)                                                                |
| `requestId` · `notFound`             | cabeçalho gerado; 404 JSON                                                                                          |
| `auth/utils`                         | cookie malformado não quebra; hash e verificação de senha                                                           |
| `auth.service` (repositórios falsos) | login (mesmo tempo com e-mail inexistente), cadastro duplicado, reset (tentativas, expiração, código reaproveitado) |
| `game services` (repositório falso)  | cada regra devolve o `code` certo: `INSUFFICIENT_FUNDS`, `NO_SEEDS`, `CROP_NOT_RIPE`, `PLOT_NOT_ADJACENT`...        |

### Integração (supertest + banco de teste)

| Área            | Casos                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth            | registrar → `/auth/me` → logout; e-mail duplicado 409; senha errada 401; 11º login em 15 min 429; reset com código inválido 400; reset derruba as sessões |
| Erros globais   | rota inexistente 404 JSON; JSON quebrado 400; body > 100kb 413; sessão inválida 401 e cookie limpo; `requestId` presente                                  |
| Game            | cada ação nos caminhos 200 / 400 / 404 / 409 / 422; colheita com sucesso (volta o `plantedAt` no banco); árvore colhida duas vezes dá 422                 |
| Concorrência    | N compras de semente em paralelo: o dinheiro nunca fica negativo e o total bate (prova o `FOR UPDATE`)                                                    |
| Falhas de infra | banco indisponível (Prisma simulado) responde 503 com `Retry-After`, sem vazar a mensagem                                                                 |

## 5. Verificação final

- `npm run build` limpo; `npm test` verde; `tsc --noEmit -p tsconfig.test.json` limpo.
- Roteiro de smoke contra o baseline: as únicas diferenças são as intencionais
  (códigos novos nos erros, 422 nas regras, 404 e JSON quebrado em JSON, mensagens em português).
- `prisma migrate status` sem alteração (schema e migrations não são tocados).

## 6. Fora do escopo

- Dependências de produção novas (pino, helmet etc.).
- Mudanças no banco ou nas regras do jogo.
- Ajustes no `dead-harvest-web` (nada que ele use muda de formato).
