# PROGRESS – dead-harvest-api

## Status do MVP
- [x] 1. Express + Postgres (Docker) + Prisma, migration inicial e rotas funcionando
- [ ] 8. Salvamento automático (lado da API pronto; depende do front chamar o PUT)

## Em andamento
Nada. Item 1 concluído; próximo trabalho é no dead-harvest-web.

## Decisões
| Data | Decisão | Motivo |
|---|---|---|
| 2026-10-20 | Express 4 | versão estável e a mais documentada para quem está aprendendo |
| 2026-10-20 | Prisma 6 (não 7) | Prisma 7 exige configuração extra (prisma.config.ts/adapters); 6 é mais simples |
| 2026-10-20 | `tsx` para rodar TypeScript em dev | sem etapa de build durante o desenvolvimento |
| 2026-10-20 | POST /players já cria o save inicial | GET /saves/:id nunca precisa criar nada; o front fica mais simples |
| 2026-10-20 | Save com 1:1 por jogador (`playerId @unique`) | só existe um save por jogador no MVP |
| 2026-10-20 | Grade validada como 10x10 no Zod | formato fixo do MVP; mudar aqui se o mapa crescer |
| 2026-10-20 | Plantas do jogo: corn, tomato, pumpkin (antes `wheat`); save inicial com `{ corn: 3, tomato: 3, pumpkin: 2 }` | afeta o formato do save (valores de `crop` e chaves do inventário); o schema Zod continua aceitando qualquer string. Front converte `wheat` antigo em `corn` ao carregar |
| 2026-10-22 | Save com `plots: [{ x, y, grid }]` no lugar de `grid`; `grid` de cada terreno continua validado como 10x10 e `plots` exige pelo menos 1 | jogador pode comprar terrenos extras. (x, y) é a posição na malha de terrenos (inteiros, podem ser negativos); o inicial é (0,0) |
| 2026-10-22 | Migration `plots` escrita à mão: renomeia a coluna `grid` para `plots` e embrulha os saves existentes como o terreno (0,0) | o `migrate dev` gerado faria drop + add e perderia os saves |
| 2026-10-22 | Preço do terreno não é validado na API | cálculo fica só no front (1000, +50% por compra); sem autenticação o save já é confiável só por convenção, no MVP |
| 2026-10-20 | Node 20 (via nvm) | Node 16 global é antigo demais para as ferramentas atuais (Vite, tsx) |

| 2026-10-22 | Banco em snake_case, ids uuid, datas timestamptz, CHECKs (migration com RENAME, sem perder dados) | padronização pedida; DROP+CREATE do Prisma apagaria o progresso |
| 2026-10-22 | **Servidor é a fonte da verdade; sem JSONB.** Tabelas: catálogo (`items`, `crops`, `trees`) e estado (`saves`, `plots`, `tiles`, `inventory_items`, `tree_harvests`), tudo com FK | decisão do dono do projeto: o front nunca é a fonte de verdade |
| 2026-10-22 | Crescimento e frutas em tempo real por timestamp (`tiles.planted_at`, `tree_harvests.harvested_at`); dia/hora do jogo = agora - `saves.game_started_at` | o servidor não confia em ticks do cliente; plantas crescem com o jogo fechado |
| 2026-10-22 | Tile só existe se arado ou plantado | terra sem arar é a ausência de linha: menos linhas |
| 2026-10-22 | Rotas `GET/PUT /saves/:id` mantidas **temporariamente** com o formato antigo, montado a partir das tabelas | o front continua funcionando; o PUT ainda deixa o cliente escrever o estado: será trocado por ações validadas no servidor |

## Problemas conhecidos
- O `PUT /saves` ainda aceita o estado vindo do cliente (dinheiro, plantas, inventário). Enquanto não existirem as ações no servidor, o front continua sendo, na prática, a fonte da verdade.
- Sem login: qualquer um com o id (uuid) lê e grava o save.
- Sem autenticação: qualquer um com o id do jogador lê/sobrescreve o save (aceito no MVP).
- Node global da máquina é 16; é preciso usar Node 18+ (`nvm use 20.20.2`).

## Próximos passos
1. Criar o dead-harvest-web (Vite + React + TS) e conectar à API (criar convidado, carregar, salvar)
2. Grade 10x10 com clique arar/plantar/colher
3. Plantas com tempos e preços diferentes

## Histórico
- 2026-10-22 – Tabelas de catálogo e de estado com FK no lugar do JSONB (migration `game_state_tables`, com carga do catálogo); `saves` ganhou `game_started_at`; README com convenções de banco e migrations; scripts `migrate:deploy`, `migrate:status`, `db:drift`.
- 2026-10-22 – Banco em snake_case (migration `snake_case_and_types`).
- 2026-10-22 – Save passa a ter `plots` (lista de terrenos) no lugar de `grid`: schema Zod, `newSave`, rotas, README e migration `plots`, que converte os saves existentes. Quebra o contrato com o front; mergear junto com o PR do web.
- 2026-10-20 – (item 4 do web) save inicial agora com sementes corn/tomato/pumpkin; README atualizado. Rotas inalteradas.
- 2026-10-20 – (sessão do front) Nenhuma mudança na API; o front usa o formato SaveData e as 3 rotas sem alterações.
- 2026-10-20 – Criado o repo: Express, Docker/Postgres, Prisma (Player/Save), migration `init`, rotas /health, /players, /saves, validação Zod, CORS por env. Testado com curl.
