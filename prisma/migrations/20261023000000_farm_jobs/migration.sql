-- Fila de trabalho do fazendeiro, no servidor: o front enfileira, o worker executa uma ação por vez
-- (andando de tile em tile) mesmo com o jogo fechado.

-- CreateEnum
CREATE TYPE "job_action" AS ENUM ('till', 'plant', 'harvest', 'harvest_tree');

-- AlterTable
ALTER TABLE "saves" ADD COLUMN "farmer_row" DOUBLE PRECISION NOT NULL DEFAULT 4,
ADD COLUMN "farmer_col" DOUBLE PRECISION NOT NULL DEFAULT -1.5,
ADD COLUMN "farmer_free_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "farm_jobs" (
    "id" UUID NOT NULL,
    "save_id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "action" "job_action" NOT NULL,
    "plot_x" INTEGER,
    "plot_y" INTEGER,
    "row" SMALLINT,
    "col" SMALLINT,
    "crop_id" TEXT,
    "tree_id" TEXT,
    "target_row" DOUBLE PRECISION NOT NULL,
    "target_col" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_jobs_pkey" PRIMARY KEY ("id"),
    -- tile: precisa do terreno e da posição; árvore: do id; plantio: da planta
    CONSTRAINT "farm_jobs_target_check" CHECK (
        ("action" = 'harvest_tree' AND "tree_id" IS NOT NULL)
        OR ("action" <> 'harvest_tree' AND "plot_x" IS NOT NULL AND "plot_y" IS NOT NULL AND "row" IS NOT NULL AND "col" IS NOT NULL)
    ),
    CONSTRAINT "farm_jobs_crop_check" CHECK (("action" = 'plant') = ("crop_id" IS NOT NULL))
);

-- CreateIndex
CREATE INDEX "farm_jobs_save_id_seq_idx" ON "farm_jobs"("save_id", "seq");

-- AddForeignKey
ALTER TABLE "farm_jobs" ADD CONSTRAINT "farm_jobs_save_id_fkey" FOREIGN KEY ("save_id") REFERENCES "saves"("id") ON DELETE CASCADE ON UPDATE CASCADE;
