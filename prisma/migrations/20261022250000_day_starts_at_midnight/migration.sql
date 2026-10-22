-- O dia do jogo passa a virar à meia-noite (antes virava às 5h). Para cada jogador continuar no
-- mesmo horário, o começo do jogo recua 5 horas de jogo. Com DAY_LENGTH_SECONDS = 1440 (24 min),
-- 5 horas de jogo = 300 segundos reais.

UPDATE "saves" SET "game_started_at" = "game_started_at" - interval '300 seconds';
