# PROGRESS – dead-harvest-api

## Status do MVP
- [x] 1. Express + Postgres (Docker) + Prisma, migration inicial e rotas funcionando
- [x] 8. Estado salvo no servidor: cada ação do jogador é uma rota validada (não existe mais "salvar")

| 2026-10-23 | **Fila do fazendeiro no servidor** (`farm_jobs`, `POST/DELETE /game/jobs`, worker de 1s em `modules/game/worker`). Arar/plantar/colher/colher árvore só existem como tarefas; as rotas diretas foram removidas | o front não controla as ações: se o jogador manda colher tudo e dá F5 (ou fecha a aba), a fila continua. Tempos por timestamp (`saves.farmer_free_at`, posição em `farmer_row/col`): cada tarefa = andar até o alvo (3,4 células/s) + gesto (550 ms), calculado no servidor e devolvido em `farmer` no estado. Ação conferida na hora em que o gesto termina; recusada pela regra = descartada. Cancelar: tudo ou uma tarefa; o que está andando para onde está. Limite 100 tarefas, sem duplicatas, tile mais perto primeiro |

## Em andamento
Armazém, máquinas e celeiro (2026-10-26): pronto e testado (279 testes), falta o dono do projeto testar no navegador.

## Decisões
| Data | Decisão | Motivo |
|---|---|---|
| 2026-10-27 | Crescimento acumulado (`growth` + `growth_at`) no lugar de calcular só pelo `planted_at` | adubar ou regar depois de plantar não pode acelerar o tempo que já passou |
| 2026-10-27 | Sem lugar fixo de prédio: o jogador constrói onde quiser; máquinas com tamanho (`size`) e o celeiro com o cercadinho | pedido do jogador: escolher o lugar e prédios com tamanho que condiz com eles |
| 2026-10-27 | (substituída pela de cima) Prédio à venda ocupa o lugar da placa; não dá para mover enquanto o fazendeiro vai coletar nele | a compra sempre põe o prédio num lugar livre; a coleta já guardou o destino na fila |
| 2026-10-20 | Express 4 | versão estável e a mais documentada para quem está aprendendo |
| 2026-10-20 | Prisma 6 (não 7) | Prisma 7 exige configuração extra (prisma.config.ts/adapters); 6 é mais simples |
| 2026-10-20 | `tsx` para rodar TypeScript em dev | sem etapa de build durante o desenvolvimento |
| 2026-10-20 | POST /players já cria o save inicial | GET /saves/:id nunca precisa criar nada; o front fica mais simples |
| 2026-10-20 | Save com 1:1 por jogador (`playerId @unique`) | só existe um save por jogador no MVP |
| 2026-10-20 | Grade validada como 10x10 no Zod | formato fixo do MVP; mudar aqui se o mapa crescer |
| 2026-10-20 | Plantas do jogo: corn, tomato, pumpkin (antes `wheat`); save inicial com `{ corn: 3, tomato: 3, pumpkin: 2 }` | afeta o formato do save (valores de `crop` e chaves do inventário); o schema Zod continua aceitando qualquer string. Front converte `wheat` antigo em `corn` ao carregar |
| 2026-10-22 | Save com `plots: [{ x, y, grid }]` no lugar de `grid`; `grid` de cada terreno continua validado como 10x10 e `plots` exige pelo menos 1 | jogador pode comprar terrenos extras. (x, y) é a posição na malha de terrenos (inteiros, podem ser negativos); o inicial é (0,0) |
| 2026-10-22 | Migration `plots` escrita à mão: renomeia a coluna `grid` para `plots` e embrulha os saves existentes como o terreno (0,0) | o `migrate dev` gerado faria drop + add e perderia os saves |
| 2026-10-26 | **Armazém**: colher não paga mais na hora; a colheita vira o item `<planta>_harvest` (kind `crop`) com o preço que a colheita pagava, vendido em `/game/items/sell` (antes `/game/fruits/sell`). `crops.harvest_price` saiu, entrou `crops.harvest_item_id` | as máquinas precisam de ingredientes guardados; o jogador decide vender cru ou processar |
| 2026-10-26 | **Máquinas** (12, catálogo `machines`/`recipes`/`recipe_inputs`): posição fixa no quintal, compra uma de cada, fila de 2 por máquina (`machine_jobs` com `starts_at`/`ready_at`; a receita seguinte começa quando a anterior fica pronta; pronta e não coletada ocupa lugar). Ingredientes saem na hora de pôr na fila; coletar é tarefa do fazendeiro (`collect_machine`) | modelo do Hay Day; tempo real por timestamp como as plantas |
| 2026-10-26 | Preço dos produtos = valor cru dos ingredientes x (1,2 + 0,15 x dias de jogo). Ração e adubo não se vendem | uma regra só para equilibrar; teste de integração garante que todo produto vale mais que os ingredientes |
| 2026-10-26 | **Celeiro**: `saves.barn_capacity` (0 = sem celeiro; compra 4 baias por 500, +2 por 400 x 1,5^n, máximo 12), `animals` (galinha/ovo, vaca/leite, ovelha/lã) e `save_animals.fed_at`. Alimentar é ação direta; coletar é tarefa do fazendeiro (`collect_barn`) e já dá ração de novo se houver. Animal sem ração só fica parado | um celeiro só com baias, como combinado; sem punição pesada |
| 2026-10-26 | **Quintal** = terreno (-1, 0), reservado (`PLOT_RESERVED`); prédios em r 1..8, c -9..-2 para um terreno vizinho comprado nunca cobrir. Árvore t5 saiu de lá | as máquinas precisam de lugar fixo no mapa; layout conferido em screenshots para não ficar atrás da HUD |
| 2026-10-26 | **Adubo** (Composteira): tarefa `fertilize` no tile arado, `tiles.fertilized`; a planta cresce 4/3 mais rápido (25% menos tempo); a colheita tira | uso para uma máquina de utilidade, sem mexer no resto do crescimento |
| 2026-10-26 | Migrations `item_kinds_and_jobs` (só os enums) e `machines_barn` (tabelas + dados) | o Postgres não deixa usar um valor novo de enum na mesma transação em que ele foi criado |
| 2026-10-26 | Entalhador (lanterna de abóbora) fica para quando houver zumbis | a lanterna só tem função espantando zumbis |
| 2026-10-20 | Node 20 (via nvm) | Node 16 global é antigo demais para as ferramentas atuais (Vite, tsx) |

| 2026-10-22 | Banco em snake_case, ids uuid, datas timestamptz, CHECKs (migration com RENAME, sem perder dados) | padronização pedida; DROP+CREATE do Prisma apagaria o progresso |
| 2026-10-22 | **Servidor é a fonte da verdade; sem JSONB.** Tabelas: catálogo (`items`, `crops`, `trees`) e estado (`saves`, `plots`, `tiles`, `inventory_items`, `tree_harvests`), tudo com FK | decisão do dono do projeto: o front nunca é a fonte de verdade |
| 2026-10-22 | Crescimento e frutas em tempo real por timestamp (`tiles.planted_at`, `tree_harvests.harvested_at`); dia/hora do jogo = agora - `saves.game_started_at` | o servidor não confia em ticks do cliente; plantas crescem com o jogo fechado |
| 2026-10-22 | Tile só existe se arado ou plantado | terra sem arar é a ausência de linha: menos linhas |
| 2026-10-22 | **Ações no servidor** (`/game/till`, `plant`, `harvest`, `seeds/buy`, `fruits/sell`, `plots/buy`, `trees/:id/harvest`) no lugar do `PUT /saves/me`; cada uma trava o save (`FOR UPDATE`) e devolve o estado inteiro | o front nunca é a fonte da verdade de nada: preços, tempos, maturidade e dinheiro são conferidos aqui; a trava impede gastar o mesmo dinheiro duas vezes com pedidos simultâneos |
| 2026-10-22 | Catálogo público em `GET /game/catalog` | o front mostra preços e tempos e desenha as árvores com os números do banco, sem cópia própria |
| 2026-10-22 | Código por domínio (`src/modules/<nome>` com controllers/dto/entities/repositories/services/utils) | padrão do dono do projeto; o Prisma só nos repositories deixa os services testáveis sem banco |
| 2026-10-22 | Erros tipados (`AppError`) e um `errorHandler` único: `{ error, code, details?, requestId }` | status certo em cada situação; `error` continua texto, então o front não muda |
| 2026-10-22 | Regra do jogo recusada passa de 409 para **422** (409 só para "já está nesse estado") | semântica correta; o front só depende de 401 e de `body.error` |
| 2026-10-22 | Testes com Vitest + supertest; integração em banco separado `<banco>_test` | não tocar nos dados de desenvolvimento |

## Problemas conhecidos
- Sem limite de taxa nas rotas do jogo (só nas de login).
- Node global da máquina é 16; é preciso usar Node 18+ (`nvm use 20.20.2`).

## Próximos passos
1. Testar armazém, máquinas e celeiro no navegador
2. Entalhador e o susto dos zumbis no celeiro (depois do item 7)
3. Ferramentas no inventário

## Histórico
- 2026-10-27 – Regador e poço: migrations `water_jobs` (tarefas `water` e `refill_can`) e `watering_can_well` (`tiles.watered`, crescimento acumulado em `tiles.growth`/`growth_at`, `saves.can_charges`, `saves.well_row/well_col`). Adubo e água valem +30% cada, somam, e funcionam antes ou depois de plantar (o acumulado é acertado antes do bônus: `utils/growth.ts`). Rotas `/game/tools/can/buy` e `/game/well/buy`; o poço se move como os outros prédios. 297 testes.
- 2026-10-27 – Esterco: migration `manure` (item `manure`, `animals.byproduct_item_id/byproduct_quantity`, receita `manure_fertilizer` na Composteira: 2 estercos -> 3 adubos). Galinha solta 1 e vaca 2 a cada coleta do celeiro; adubo passa a dar 30% mais rápido (`FERTILIZER_SPEEDUP = 1.3`, antes 4/3). Catálogo com `byproductItemId`/`byproductQuantity` nos animais. 289 testes.
- 2026-10-27 – Prédios só dentro dos terrenos comprados: o chão tem que cair inteiro em terreno do jogador, sem terra arada nem outro prédio; embaixo de prédio não se ara (`TILES_UNDER_BUILDING`). Saem `MAP_AREA`, as árvores da regra e o `PLOT_BLOCKED`. 288 testes.
- 2026-10-27 – Construir onde quiser: migration `buildings_placed_by_player` (`machines.size`, sai `machines.row/col`, celeiro com lugar obrigatório quando existe, os prédios já comprados vão para um arranjo espaçado). `POST /game/machines/buy` e `/game/barn/buy` recebem `{ row, col }` e conferem o lugar (`PLACE_BLOCKED`); o quintal (-1,0) deixa de ser reservado (sai `PLOT_RESERVED` e `reservedPlots`); catálogo com `machines[].size` e `layout.barnFootprint`; área de construção maior. 289 testes.
- 2026-10-27 – Prédios arrastáveis: migration `building_positions` (`save_machines.row/col`, `saves.barn_row/barn_col`), `utils/layout.ts` (chão de cada prédio, área do mapa, onde o fazendeiro para), `services/layout.service.ts`, rota `POST /game/buildings/move` (`PLACE_BLOCKED`, `BUILDING_BUSY`), terreno novo não cobre prédio (`PLOT_BLOCKED`), coleta vai até o lugar novo, catálogo com `layout`. Testes: `tests/unit/game/layout.test.ts` e casos novos em `production.test.ts` e `game-actions.service.test.ts` (291 no total).
- 2026-10-26 – Armazém, 12 máquinas, celeiro com galinha/vaca/ovelha e adubo: migrations `item_kinds_and_jobs` e `machines_barn`, `services/production.service.ts` (máquinas, celeiro, animais), `utils/growth.ts`, rotas `/game/items/sell`, `/game/machines/{buy,start}`, `/game/barn/{buy,expand}`, `/game/animals/{buy,feed}`, tarefas `fertilize`/`collect_machine`/`collect_barn`, catálogo com `items`, `machines`, `animals`, `barn`, `fertilizer`, `reservedPlots`. Testes novos: `tests/unit/game/production.service.test.ts` e `tests/integration/production.test.ts` (279 no total).
- 2026-10-22 – Duração do dia em `DAY_LENGTH_SECONDS` no `.env` (agora 1440 = 24 min); jogo novo começa às 8h; relógio linear (1 s = 1 min) com fases por horário: amanhecer 5h–8h, manhã 8h–13h, tarde 13h–19h, noite 19h–5h. O front lê do catálogo.
- 2026-10-22 – Ações do jogo no servidor (`services/game.ts`, `routes/game.ts`, `schemas/game.ts`) e `GET /game/catalog`/`GET /game/state`; removidos `GET/PUT /saves/me`. Testado com 31 verificações (regras, erros, corrida de 20 compras simultâneas). Chapéu de flor e camisa amarela removidos do avatar (migration `avatar_drop_flower_yellow_shirt`).
- 2026-10-22 – Tabelas de catálogo e de estado com FK no lugar do JSONB (migration `game_state_tables`, com carga do catálogo); `saves` ganhou `game_started_at`; README com convenções de banco e migrations; scripts `migrate:deploy`, `migrate:status`, `db:drift`.
- 2026-10-22 – Banco em snake_case (migration `snake_case_and_types`).
- 2026-10-22 – Save passa a ter `plots` (lista de terrenos) no lugar de `grid`: schema Zod, `newSave`, rotas, README e migration `plots`, que converte os saves existentes. Quebra o contrato com o front; mergear junto com o PR do web.
- 2026-10-20 – (item 4 do web) save inicial agora com sementes corn/tomato/pumpkin; README atualizado. Rotas inalteradas.
- 2026-10-20 – (sessão do front) Nenhuma mudança na API; o front usa o formato SaveData e as 3 rotas sem alterações.
- 2026-10-20 – Criado o repo: Express, Docker/Postgres, Prisma (Player/Save), migration `init`, rotas /health, /players, /saves, validação Zod, CORS por env. Testado com curl.
