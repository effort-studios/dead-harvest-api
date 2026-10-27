-- O jogador constrói onde quiser: escolhe o prédio na loja e clica no mapa. Não existe mais lugar fixo de
-- máquina (machines.row/col) nem do celeiro, e o quintal (terreno -1,0) deixa de ser reservado.
-- Cada máquina passa a ter um tamanho: ocupa size x size células (prensa de sucos 1, moinho 2...).

ALTER TABLE "machines" ADD COLUMN "size" INTEGER;
UPDATE "machines" SET "size" = CASE "id"
  WHEN 'juicer' THEN 1 WHEN 'fryer' THEN 1 WHEN 'composter' THEN 1 WHEN 'loom' THEN 1 WHEN 'oven' THEN 1
  ELSE 2 END;
ALTER TABLE "machines" ALTER COLUMN "size" SET NOT NULL;
ALTER TABLE "machines" ADD CONSTRAINT "machines_size_check" CHECK ("size" BETWEEN 1 AND 3);
ALTER TABLE "machines" DROP COLUMN "row", DROP COLUMN "col";

-- Com os tamanhos novos, os prédios já comprados se encostariam: vão para um arranjo espaçado acima e à
-- esquerda da plantação (o jogador arrasta depois)
UPDATE "save_machines" sm SET "row" = p."row", "col" = p."col"
FROM (VALUES
  ('juicer', -2, -8), ('feed_mill', -3, -11), ('mill', 0, -13), ('cannery', 3, -13), ('fryer', -2, -6),
  ('composter', -5, -10), ('dairy', -10, -6), ('candy', 0, -16), ('loom', -2, -4), ('oven', -2, -13),
  ('ice_cream', -10, -3), ('kitchen', 3, -16)
) AS p("machine_id", "row", "col")
WHERE sm."machine_id" = p."machine_id";

-- Celeiro: com celeiro, sempre tem lugar; sem, os dois ficam nulos
UPDATE "saves" SET "barn_row" = -6, "barn_col" = -7 WHERE "barn_capacity" > 0;
UPDATE "saves" SET "barn_row" = NULL, "barn_col" = NULL WHERE "barn_capacity" = 0;
ALTER TABLE "saves" ADD CONSTRAINT "saves_barn_position_check"
  CHECK (("barn_capacity" = 0) = ("barn_row" IS NULL) AND ("barn_row" IS NULL) = ("barn_col" IS NULL));
