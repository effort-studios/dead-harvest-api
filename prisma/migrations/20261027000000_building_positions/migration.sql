-- Prédios no lugar que o jogador escolher (arrastando no mapa). machines.row/col vira só o lugar onde a
-- máquina aparece à venda e onde ela começa ao ser comprada.

-- Máquina comprada: onde o jogador deixou (as compradas antes ficam no lugar de sempre)
ALTER TABLE "save_machines" ADD COLUMN "row" INTEGER, ADD COLUMN "col" INTEGER;
UPDATE "save_machines" sm SET "row" = m."row", "col" = m."col" FROM "machines" m WHERE m."id" = sm."machine_id";
ALTER TABLE "save_machines" ALTER COLUMN "row" SET NOT NULL, ALTER COLUMN "col" SET NOT NULL;

-- Celeiro: nulo = no lugar de sempre (game.constants BARN)
ALTER TABLE "saves" ADD COLUMN "barn_row" INTEGER, ADD COLUMN "barn_col" INTEGER;
