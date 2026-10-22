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
| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | `{ "status": "ok" }` |
| POST | `/players` | cria jogador convidado + save inicial → `201 { "id": "..." }` |
| GET | `/saves/:playerId` | carrega o save (404 se não existir) |
| PUT | `/saves/:playerId` | salva o estado (400 se o corpo for inválido, 404 se o jogador não existir) |

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

## Formato do save (transitório)
Hoje o front ainda envia e recebe o save inteiro neste formato (tipo `SaveData`, em [src/schemas/save.ts](src/schemas/save.ts)). A API o monta a partir das tabelas e o grava nelas; `growth` e `time` são calculados a partir dos timestamps. Isto deve ser substituído por ações validadas no servidor (arar, plantar, colher, comprar...).

```ts
type Tile = {
  state: "soil" | "tilled" | "planted"; // terra, arada, plantada
  crop: string | null;                  // id da planta, ex.: "corn", "tomato" (ou null)
  growth: number;                       // ticks de crescimento (inteiro >= 0)
};

type Plot = {
  x: number;                            // posição do terreno na malha de terrenos (inteiro, pode ser negativo)
  y: number;
  grid: Tile[][];                       // 10 linhas x 10 colunas
};

type SaveData = {
  day: number;                          // inteiro >= 1
  time: number;                         // segundos desde o amanhecer do dia (inteiro >= 0)
  money: number;                        // inteiro >= 0
  plots: Plot[];                        // terrenos do jogador (pelo menos 1; o inicial é 0,0)
  inventory: Record<string, number>;    // sementes e frutas guardadas, ex.: { corn: 3, apple: 2 }
  trees: Record<string, number>;        // id da árvore -> ms (Date.now) da última coleta de frutas
};
```
O GET devolve também `updatedAt` (ISO 8601).

Save inicial: dia 1, 100 de dinheiro, um terreno em (0,0) todo `soil`, sementes `{ corn: 3, tomato: 3, pumpkin: 2 }`.

## Testar rápido
```bash
curl localhost:3333/health
curl -X POST localhost:3333/players          # copie o id
curl localhost:3333/saves/<id>
```
