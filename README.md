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
| `npm run migrate` | cria/aplica migrations (`prisma migrate dev`) |

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

## Formato do save
O front (`dead-harvest-web`) precisa usar exatamente este formato (tipo `SaveData`). A fonte da verdade é [src/schemas/save.ts](src/schemas/save.ts).

```ts
type Tile = {
  state: "soil" | "tilled" | "planted"; // terra, arada, plantada
  crop: string | null;                  // id da planta, ex.: "corn", "tomato" (ou null)
  growth: number;                       // ticks de crescimento (inteiro >= 0)
};

type SaveData = {
  day: number;                          // inteiro >= 1
  time: number;                         // segundos desde o amanhecer do dia (inteiro >= 0)
  money: number;                        // inteiro >= 0
  grid: Tile[][];                       // 10 linhas x 10 colunas
  inventory: Record<string, number>;    // sementes e frutas guardadas, ex.: { corn: 3, apple: 2 }
  trees: Record<string, number>;        // id da árvore -> ms (Date.now) da última coleta de frutas
};
```
O GET devolve também `updatedAt` (ISO 8601).

Save inicial: dia 1, 100 de dinheiro, grade toda `soil`, sementes `{ corn: 3, tomato: 3, pumpkin: 2 }`.

## Testar rápido
```bash
curl localhost:3333/health
curl -X POST localhost:3333/players          # copie o id
curl localhost:3333/saves/<id>
```
