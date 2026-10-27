-- Regador e poço. O regador se compra na loja (10 cargas; cada tile regado gasta 1) e se enche no poço, um
-- prédio de 1 célula que o jogador constrói onde quiser nos terrenos dele. Regar faz a planta crescer 30% mais
-- rápido e soma com o adubo; os dois agora valem também depois de plantar.

-- Tile: regado (como o adubo, até a colheita). O crescimento passa a ser acumulado: `growth` segundos de
-- planta até `growth_at`, e daí em diante cresce na velocidade do tile (1 + 0,3 com adubo + 0,3 regado). Adubar
-- ou regar uma planta acerta o acumulado antes de mudar a velocidade.
ALTER TABLE "tiles" ADD COLUMN "watered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tiles" ADD COLUMN "growth" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "tiles" ADD COLUMN "growth_at" TIMESTAMPTZ(3);
UPDATE "tiles" SET "growth_at" = "planted_at" WHERE "state" = 'planted';
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_growth_check"
  CHECK ("growth" >= 0 AND (("state" = 'planted') = ("growth_at" IS NOT NULL)));

-- Save: cargas do regador (nulo = não tem regador) e onde está o poço (nulos = sem poço)
ALTER TABLE "saves" ADD COLUMN "can_charges" INTEGER;
ALTER TABLE "saves" ADD COLUMN "well_row" INTEGER;
ALTER TABLE "saves" ADD COLUMN "well_col" INTEGER;
ALTER TABLE "saves" ADD CONSTRAINT "saves_can_charges_check" CHECK ("can_charges" IS NULL OR "can_charges" >= 0);
ALTER TABLE "saves" ADD CONSTRAINT "saves_well_position_check" CHECK (("well_row" IS NULL) = ("well_col" IS NULL));

-- Fila: regar é tarefa de tile; encher o regador não tem alvo (o fazendeiro vai até o poço)
ALTER TABLE "farm_jobs" DROP CONSTRAINT "farm_jobs_target_check";
ALTER TABLE "farm_jobs" ADD CONSTRAINT "farm_jobs_target_check" CHECK (
    ("action" = 'harvest_tree' AND "tree_id" IS NOT NULL)
    OR ("action" = 'collect_machine' AND "machine_id" IS NOT NULL)
    OR ("action" IN ('collect_barn', 'refill_can'))
    OR ("action" IN ('till', 'plant', 'harvest', 'fertilize', 'water') AND "plot_x" IS NOT NULL AND "plot_y" IS NOT NULL AND "row" IS NOT NULL AND "col" IS NOT NULL)
);
