-- Fila: desfazer a aragem é tarefa de tile, como arar
ALTER TABLE "farm_jobs" DROP CONSTRAINT "farm_jobs_target_check";
ALTER TABLE "farm_jobs" ADD CONSTRAINT "farm_jobs_target_check" CHECK (
    ("action" = 'harvest_tree' AND "tree_id" IS NOT NULL)
    OR ("action" = 'collect_machine' AND "machine_id" IS NOT NULL)
    OR ("action" IN ('collect_barn', 'refill_can', 'move'))
    OR ("action" IN ('till', 'untill', 'plant', 'harvest', 'fertilize', 'water') AND "plot_x" IS NOT NULL AND "plot_y" IS NOT NULL AND "row" IS NOT NULL AND "col" IS NOT NULL)
);
