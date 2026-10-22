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

## Estrutura
- `src/routes` – rotas HTTP (recebem a requisição e respondem)
- `src/services` – acesso ao banco via Prisma
- `src/schemas` – validação do corpo das requisições (Zod)
- `prisma/` – schema do banco e migrations

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
em [src/services/game.ts](src/services/game.ts), com o catálogo do banco. Cada ação trava o save do jogador
(`SELECT ... FOR UPDATE`), então ações ao mesmo tempo (cliques rápidos, duas abas) entram em fila.
`tiles` tem de 1 a 10 tiles (um tile, ou uma linha/coluna do terreno `x, y`).

Respostas das ações e do `/game/state`: o estado novo (abaixo). Erros: `400` corpo inválido, `401` sem
sessão, `404` terreno/árvore/save inexistente, `409` regra do jogo recusada (`{ error }` com a mensagem
para o jogador: sem dinheiro, planta verde, árvore sem frutas...).

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
