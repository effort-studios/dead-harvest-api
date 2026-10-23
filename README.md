# dead-harvest-api

Backend do **Dead Harvest**: Node.js + TypeScript + Express + PostgreSQL (Docker) + Prisma + Zod.

## Pré-requisitos
- Node.js 18 ou mais novo (testado com 20)
- Docker Desktop ligado

## Como rodar
```bash
npm install
cp .env.example .env        # ajuste se precisar (nunca commite o .env)
npm run db:up               # sobe o Postgres no Docker
npx prisma migrate dev      # cria as tabelas
npm run dev                 # API em http://localhost:3333
```

## Scripts
| Comando | O que faz |
|---|---|
| `npm run dev` | API com recarga automática |
| `npm run build` / `npm start` | compila e roda a versão de produção |
| `npm run db:up` / `db:down` | liga / desliga o Postgres |
| `npm run migrate` | cria/aplica migrations em desenvolvimento (`prisma migrate dev`) |
| `npm run migrate:deploy` | aplica as migrations pendentes sem criar nada (outros ambientes, CI) |
| `npm run migrate:status` | mostra quais migrations já foram aplicadas |
| `npm run db:drift` | falha se o banco divergir do `schema.prisma` |
| `npm test` | roda todos os testes (unitários + integração) |
| `npm run test:unit` / `test:int` | só os unitários (sem banco) / só os de integração (HTTP + banco) |
| `npm run typecheck` | confere os tipos do código e dos testes |

## Estrutura
Organizada por domínio. Cada módulo em `src/modules/<nome>` segue o mesmo padrão:

```
src/modules/<nome>/
  controllers/    # lê a requisição, chama o service e monta a resposta (status, cookie, JSON)
  dto/            # schemas de entrada (Zod) e tipos
  entities/       # tipos e mapeamentos do domínio
  enums/          # listas fixas (ex.: peças do avatar)
  repositories/   # único lugar que fala com o Prisma
  services/       # regra de negócio; lança erros tipados, não conhece Express nem Prisma
  utils/          # funções de apoio do módulo
  <nome>.module.ts  # monta o Router: URL → middlewares → controller
```

| Módulo | Cuida de |
|---|---|
| `auth` | cadastro, login/logout, sessão (cookie), recuperação de senha |
| `users` | perfil: nome e avatar (`PATCH /auth/me`) |
| `game` | catálogo, estado e todas as ações do jogo |
| `health` | `GET /health` |

`src/shared` tem o que é comum a todos: `errors/` (hierarquia de erros), `http/` (errorHandler, validate,
asyncHandler, rateLimit, requestId, notFound) e `database/` (cliente do Prisma). `prisma/` tem o schema e as
migrations, e `tests/` espelha os módulos (`unit/` e `integration/`).

## Rotas
Sessão por cookie httpOnly (`dh_session`): o front chama com `credentials: 'include'`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | `{ "status": "ok" }` |
| POST | `/auth/register` | cria conta + save inicial e já entra |
| POST | `/auth/login` / `/auth/logout` | entra / sai |
| GET / PATCH | `/auth/me` | usuário logado / muda nome e avatar |
| POST | `/auth/forgot-password` / `/auth/reset-password` | código por e-mail / nova senha com o código |
| GET | `/game/catalog` | regras do jogo (plantas, frutas, árvores, preço do terreno, duração do dia); público |
| GET | `/game/state` | estado do jogador logado |
| POST | `/game/till` | `{ x, y, tiles: [{ row, col }] }`: ara os tiles que ainda são terra |
| POST | `/game/plant` | `{ x, y, tiles, cropId }`: planta nos tiles arados, na ordem, enquanto houver semente |
| POST | `/game/harvest` | `{ x, y, tiles }`: colhe as plantas maduras e paga a colheita |
| POST | `/game/seeds/buy` | `{ cropId, quantity }`: compra o que o dinheiro der (até `quantity`) |
| POST | `/game/fruits/sell` | `{ itemId, quantity? }`: vende (todas, sem `quantity`) |
| POST | `/game/plots/buy` | `{ x, y }`: compra um terreno colado a um seu |
| POST | `/game/trees/:treeId/harvest` | colhe as frutas de uma árvore, se já repôs |

**O servidor é a fonte da verdade.** O cliente só diz o que quer fazer; preço, tempo e se pode são decididos
em [game-actions.service.ts](src/modules/game/services/game-actions.service.ts), com o catálogo do banco. Cada ação
trava o save do jogador (`SELECT ... FOR UPDATE`, em [game.repository.ts](src/modules/game/repositories/game.repository.ts)),
então ações ao mesmo tempo (cliques rápidos, duas abas) entram em fila e, se uma falhar no meio, nada fica gravado.
`tiles` tem de 1 a 10 tiles (um tile, ou uma linha/coluna do terreno `x, y`).

Respostas das ações e do `/game/state`: o estado novo (abaixo).

## Erros
Toda falha sai por um único lugar ([errorHandler](src/shared/http/errorHandler.ts)), no mesmo formato:

```json
{ "error": "Dinheiro insuficiente", "code": "INSUFFICIENT_FUNDS", "details": [], "requestId": "…" }
```

- `error`: mensagem em português, pronta para mostrar ao jogador (é só isso que o front lê).
- `code`: identificador estável da situação (para o front ou testes decidirem sem comparar texto).
- `details`: só em `400` de validação: `[{ path, message }]` por campo.
- `requestId`: o mesmo do cabeçalho `X-Request-Id`; um `500` é logado com ele, com o stack.

| Status | Quando | Exemplos de `code` |
|---|---|---|
| `400` | pedido inválido: formato, referência que não existe, código de redefinição errado | `VALIDATION_ERROR`, `INVALID_JSON`, `UNKNOWN_CROP`, `UNKNOWN_SEED`, `ITEM_NOT_SELLABLE`, `INVALID_RESET_CODE` |
| `401` | sem sessão válida ou credenciais erradas | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` |
| `404` | terreno, árvore, save ou rota inexistente | `PLOT_NOT_FOUND`, `TREE_NOT_FOUND`, `SAVE_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| `409` | o alvo já está no estado pedido | `EMAIL_TAKEN`, `TILES_ALREADY_TILLED`, `PLOT_ALREADY_OWNED` |
| `413` | corpo maior que 100kb | `PAYLOAD_TOO_LARGE` |
| `422` | uma regra do jogo não deixa | `INSUFFICIENT_FUNDS`, `NO_SEEDS`, `NOT_ENOUGH_ITEMS`, `TILES_NOT_TILLED`, `CROP_NOT_RIPE`, `TREE_NOT_READY`, `PLOT_NOT_ADJACENT` |
| `429` | limite de tentativas (login, cadastro, redefinição); traz `Retry-After` | `TOO_MANY_REQUESTS` |
| `503` | banco indisponível ou conflito de transação; traz `Retry-After`, o cliente pode tentar de novo | `DATABASE_UNAVAILABLE` |
| `500` | qualquer erro inesperado; a mensagem interna **nunca** vai na resposta | `INTERNAL_ERROR` |

Para criar um erro novo, lance uma subclasse de `AppError` ([AppError.ts](src/shared/errors/AppError.ts)) no service
com um `code` próprio; não precisa tratar nada no controller.

## Testes
`npm test` roda tudo. Os **unitários** (`tests/unit`) testam os services com repositórios falsos e não precisam de banco.
Os de **integração** (`tests/integration`) chamam a API de verdade (supertest) contra um banco **separado**,
`<seu banco>_test`, criado e migrado sozinho no mesmo Postgres do Docker: o banco de desenvolvimento nunca é tocado.
Precisam do `npm run db:up` ligado.

## Banco de dados
O servidor é a fonte da verdade do jogo: não há JSON no banco. Convenção: tabelas no plural e colunas em `snake_case` (`@@map`/`@map`; no código continua camelCase), ids `uuid`, datas `timestamptz`.

| Grupo | Tabelas | Observação |
|---|---|---|
| Conta | `users` | |
| Catálogo (regras do jogo, iguais para todos, populadas por migration) | `items`, `crops`, `trees` | `items` = sementes e frutas; `crops` = tempo de crescimento e preço de colheita; `trees` = árvores do cenário |
| Estado do jogador | `saves`, `plots`, `tiles`, `inventory_items`, `tree_harvests` | tudo com FK para `saves` (apagar o usuário apaga tudo em cascata) |

- Só existe linha em `tiles` para tile **arado ou plantado**; terra sem arar é a ausência de linha.
- Plantas e árvores usam **timestamps** (`tiles.planted_at`, `tree_harvests.harvested_at`), então crescem em tempo real, mesmo com o jogo fechado. O dia/hora do jogo vem de `saves.game_started_at`.
- Regras (`CHECK`): dinheiro >= 0, tile plantado tem planta e hora, quantidades > 0, preços coerentes com o tipo do item.

### Migrations
- Criar: altere o `schema.prisma` e rode `npm run migrate -- --name <o_que_mudou>` (nome em snake_case).
- **Renomear coluna/tabela nunca com o SQL gerado sozinho**: o Prisma gera `DROP` + `CREATE` e apaga os dados. Use `--create-only` e escreva `ALTER ... RENAME` (veja `*_snake_case_and_types`).
- Dados do catálogo (novas plantas, itens) entram por migration, com `INSERT`.
- Ao mesclar uma branch com migration, **renomeie a pasta** para um timestamp posterior ao da `main`, para a ordem de aplicação ser a ordem de criação.
- Outros ambientes: `npm run migrate:deploy`. Antes de abrir PR: `npm run db:drift` (garante que o schema e as migrations batem).
- O Prisma não tem migration de volta: mudanças destrutivas em duas etapas (adiciona, migra os dados, só depois remove) e backup antes.

## Estado do jogador
Montado a partir das tabelas em cada resposta; `growth`, `day` e `time` são calculados pelos timestamps.

```ts
type Tile = {
  state: "soil" | "tilled" | "planted"; // terra, arada, plantada
  crop: string | null;                  // id da planta, ex.: "corn" (ou null)
  growth: number;                       // segundos desde o plantio
};

type Plot = {
  x: number;                            // posição do terreno na malha de terrenos (pode ser negativo)
  y: number;
  grid: Tile[][];                       // 10 linhas x 10 colunas
};

type GameState = {
  serverTime: number;                   // ms do relógio do servidor (o cliente acerta o relógio dele)
  day: number;                          // >= 1
  time: number;                         // segundos desde o início do dia
  money: number;
  plots: Plot[];                        // ordenados por y, x
  inventory: Record<string, number>;    // sementes e frutas, ex.: { corn: 3, apple: 2 }
  trees: Record<string, number>;        // id da árvore -> ms da última colheita
};
```

Save inicial: 100 de dinheiro, um terreno em (0,0) todo `soil`, sementes `{ corn: 3, tomato: 3, pumpkin: 2 }`.

## Testar rápido
```bash
curl localhost:3333/health
curl localhost:3333/game/catalog
```
