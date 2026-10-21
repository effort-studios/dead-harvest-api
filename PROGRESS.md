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
| 2026-10-20 | Node 20 (via nvm) | Node 16 global é antigo demais para as ferramentas atuais (Vite, tsx) |

## Problemas conhecidos
- Sem autenticação: qualquer um com o id do jogador lê/sobrescreve o save (aceito no MVP).
- Node global da máquina é 16; é preciso usar Node 18+ (`nvm use 20.20.2`).

## Próximos passos
1. Criar o dead-harvest-web (Vite + React + TS) e conectar à API (criar convidado, carregar, salvar)
2. Grade 10x10 com clique arar/plantar/colher
3. Plantas com tempos e preços diferentes

## Histórico
- 2026-10-20 – (sessão do front) Nenhuma mudança na API; o front usa o formato SaveData e as 3 rotas sem alterações.
- 2026-10-20 – Criado o repo: Express, Docker/Postgres, Prisma (Player/Save), migration `init`, rotas /health, /players, /saves, validação Zod, CORS por env. Testado com curl.
