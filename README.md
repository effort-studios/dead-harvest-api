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
| GET | `/game/catalog` | regras do jogo (plantas, itens, árvores, máquinas e receitas, animais, celeiro, adubo, preço do terreno, duração do dia); público |
| GET | `/game/state` | estado do jogador logado |
| POST | `/game/jobs` | Enfileira trabalho do fazendeiro: `{ action: "till"\|"harvest"\|"fertilize", x, y, tiles }`, `{ action: "plant", x, y, tiles, cropId }`, `{ action: "harvest_tree", treeId }`, `{ action: "collect_machine", machineId }` ou `{ action: "collect_barn" }`. Vira uma tarefa por tile (mais perto primeiro, até 100 na fila); o servidor anda e executa uma de cada vez, mesmo com o jogo fechado. 422 `FARM_QUEUE_FULL` se estourar |
| DELETE | `/game/jobs` | cancela a fila toda (ele para onde está) |
| DELETE | `/game/jobs/:jobId` | cancela uma tarefa (404 `JOB_NOT_FOUND` se não for do jogador) |
| POST | `/game/seeds/buy` | `{ cropId, quantity }`: compra o que o dinheiro der (até `quantity`) |
| POST | `/game/items/sell` | `{ itemId, quantity? }`: vende um item do armazém (todos, sem `quantity`) |
| POST | `/game/plots/buy` | `{ x, y }`: compra um terreno colado a um seu |
| POST | `/game/machines/buy` | `{ machineId, row, col }`: constrói a máquina com a célula de cima do chão dela em (row, col); ela ocupa `size` x `size` células (lugar ruim: 422 `PLACE_BLOCKED`) |
| POST | `/game/machines/start` | `{ recipeId }`: gasta os ingredientes e põe a receita na fila da máquina (começa quando a anterior fica pronta) |
| POST | `/game/barn/buy` / `/game/barn/expand` | `{ row, col }`: constrói o celeiro (4 baias) com o meio em (row, col), chão em `layout.barnFootprint` / amplia (+2 baias, preço sobe 50% a cada vez, até 12) |
| POST | `/game/animals/buy` | `{ animalId }`: compra um animal (precisa de baia livre); chega com fome |
| POST | `/game/animals/feed` | dá ração aos animais com fome, do mais antigo ao mais novo, enquanto houver |
| POST | `/game/tools/can/buy` | compra o regador (vem com 10 cargas; 409 `CAN_ALREADY_OWNED`) |
| POST | `/game/well/buy` | `{ row, col }`: constrói o poço (1 célula), onde o fazendeiro enche o regador |
| POST | `/game/buildings/move` | `{ kind: "machine", machineId, row, col }` ou `{ kind: "barn", row, col }`: muda um prédio comprado de lugar. O chão dele tem que caber nos terrenos do jogador, sem terra arada nem outro prédio (422 `PLACE_BLOCKED`); enquanto o fazendeiro vai coletar nele, 422 `BUILDING_BUSY` |

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
| `400` | pedido inválido: formato, referência que não existe, código de redefinição errado | `VALIDATION_ERROR`, `INVALID_JSON`, `UNKNOWN_CROP`, `UNKNOWN_SEED`, `ITEM_NOT_SELLABLE`, `UNKNOWN_MACHINE`, `UNKNOWN_RECIPE`, `UNKNOWN_ANIMAL`, `INVALID_RESET_CODE` |
| `401` | sem sessão válida ou credenciais erradas | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` |
| `404` | terreno, árvore, máquina, save ou rota inexistente | `PLOT_NOT_FOUND`, `TREE_NOT_FOUND`, `MACHINE_NOT_FOUND`, `SAVE_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| `409` | o alvo já está no estado pedido | `EMAIL_TAKEN`, `TILES_ALREADY_TILLED`, `TILES_ALREADY_FERTILIZED`, `PLOT_ALREADY_OWNED`, `MACHINE_ALREADY_OWNED`, `BARN_ALREADY_OWNED` |
| `413` | corpo maior que 100kb | `PAYLOAD_TOO_LARGE` |
| `422` | uma regra do jogo não deixa | `INSUFFICIENT_FUNDS`, `NO_SEEDS`, `NO_FERTILIZER`, `NOT_ENOUGH_ITEMS`, `TILES_NOT_TILLED`, `CROP_NOT_RIPE`, `TREE_NOT_READY`, `PLOT_NOT_ADJACENT`, `TILES_UNDER_BUILDING`, `NO_CAN`, `CAN_EMPTY`, `NO_WELL`, `PLACE_BLOCKED`, `BUILDING_BUSY`, `MACHINE_NOT_OWNED`, `MACHINE_QUEUE_FULL`, `MACHINE_NOT_READY`, `NO_BARN`, `BARN_FULL`, `BARN_MAX_SIZE`, `BARN_NOT_READY`, `NO_HUNGRY_ANIMALS`, `NO_FEED` |
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
| Catálogo (regras do jogo, iguais para todos, populadas por migration) | `items`, `crops`, `trees`, `machines`, `recipes`, `recipe_inputs`, `animals` | `items` = sementes, frutas, colheitas (`crop`), produtos dos animais e das máquinas, com o preço de venda; `crops` = tempo de crescimento e o item que a colheita dá; `trees` = árvores do cenário; `machines` = máquinas (tamanho no mapa `size` x `size`, tamanho da fila); `recipes`/`recipe_inputs` = ingredientes -> produto e tempo; `animals` = ração, produto, tempo e o que soltam junto a cada coleta (`byproduct_item_id`: esterco) |
| Estado do jogador | `saves`, `plots`, `tiles`, `inventory_items`, `tree_harvests`, `save_machines`, `machine_jobs`, `save_animals`, `farm_jobs` | tudo com FK para `saves` (apagar o usuário apaga tudo em cascata); `saves.barn_capacity` = baias do celeiro (0 = sem celeiro); `saves.barn_row/barn_col` e `save_machines.row/col` = onde o jogador construiu cada prédio (celeiro nulo = sem celeiro) |

- Só existe linha em `tiles` para tile **arado ou plantado**; terra sem arar é a ausência de linha.
- Plantas, árvores, máquinas e animais usam **timestamps** (`tiles.planted_at`, `tree_harvests.harvested_at`, `machine_jobs.ready_at`, `save_animals.fed_at`), então andam em tempo real, mesmo com o jogo fechado. O dia/hora do jogo vem de `saves.game_started_at`.
- **Colher não paga na hora**: a colheita vira um item (`<planta>_harvest`) no armazém (inventário), que se vende em `/game/items/sell` ou vira ingrediente. Tile adubado (`tiles.fertilized`) faz a planta crescer 4/3 mais rápido; a colheita tira o adubo.
- **Prédios**: o jogador constrói onde quiser e arrasta depois (`save_machines.row/col`, `saves.barn_row/barn_col`); as regras de lugar ficam em `utils/layout.ts`: o chão do prédio cai inteiro dentro dos terrenos do jogador (pode passar de um para o vizinho), sem terra arada nem outro prédio, e embaixo de prédio não se ara (422 `TILES_UNDER_BUILDING`). Cada máquina tem uma fila (`machines.queue_size`, hoje 2; receita pronta e não coletada ocupa lugar); coletar e pegar os produtos do celeiro são tarefas do fazendeiro.
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
  growth: number;                       // segundos de crescimento (adubado conta 4/3 por segundo)
  fertilized: boolean;                  // adubado
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
  inventory: Record<string, number>;    // armazém: sementes, frutas, colheitas, produtos, ex.: { corn: 3, corn_harvest: 2, apple: 2 }
  trees: Record<string, number>;        // id da árvore -> ms da última colheita
  machines: Record<string, { jobs: { id: string; recipeId: string; startsAt: number; readyAt: number }[] }>; // só as compradas
  barn: { capacity: number; animals: { id: string; animalId: string; fedAt: number | null }[] }; // fedAt null = com fome
  farmer: { row: number; col: number; jobs: FarmJob[] }; // fila do fazendeiro
};
```

Save inicial: 100 de dinheiro, um terreno em (0,0) todo `soil`, sementes `{ corn: 3, tomato: 3, pumpkin: 2 }`.

## Testar rápido
```bash
curl localhost:3333/health
curl localhost:3333/game/catalog
```
