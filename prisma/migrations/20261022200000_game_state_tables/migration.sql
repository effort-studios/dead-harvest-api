-- O estado do jogo sai do JSONB e vira tabelas com FK. O servidor passa a ser a fonte da verdade.
--   catálogo: items, crops, trees (regras do jogo, populadas aqui)
--   estado:   saves, plots, tiles, inventory_items, tree_harvests
-- Os saves antigos (day, time, plots, inventory, trees em JSONB) são descartados: a tabela foi zerada
-- antes desta migration, então não há progresso a converter.
-- O tempo de jogo deixa de ser "ticks do cliente": plantas e árvores usam timestamps do servidor.

-- CreateEnum
CREATE TYPE "item_kind" AS ENUM ('seed', 'fruit');

-- CreateEnum
CREATE TYPE "tile_state" AS ENUM ('tilled', 'planted');

-- AlterTable
ALTER TABLE "saves" DROP COLUMN "day",
DROP COLUMN "inventory",
DROP COLUMN "plots",
DROP COLUMN "time",
DROP COLUMN "trees",
ADD COLUMN     "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "game_started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "kind" "item_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "buy_price" INTEGER,
    "sell_price" INTEGER,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crops" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grow_seconds" INTEGER NOT NULL,
    "harvest_price" INTEGER NOT NULL,
    "seed_item_id" TEXT NOT NULL,

    CONSTRAINT "crops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trees" (
    "id" TEXT NOT NULL,
    "fruit_item_id" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "col" INTEGER NOT NULL,
    "fruits_per_harvest" INTEGER NOT NULL,
    "regrow_seconds" INTEGER NOT NULL,

    CONSTRAINT "trees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plots" (
    "id" UUID NOT NULL,
    "save_id" UUID NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,

    CONSTRAINT "plots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tiles" (
    "plot_id" UUID NOT NULL,
    "row" SMALLINT NOT NULL,
    "col" SMALLINT NOT NULL,
    "state" "tile_state" NOT NULL,
    "crop_id" TEXT,
    "planted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tiles_pkey" PRIMARY KEY ("plot_id","row","col")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "save_id" UUID NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("save_id","item_id")
);

-- CreateTable
CREATE TABLE "tree_harvests" (
    "save_id" UUID NOT NULL,
    "tree_id" TEXT NOT NULL,
    "harvested_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tree_harvests_pkey" PRIMARY KEY ("save_id","tree_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crops_seed_item_id_key" ON "crops"("seed_item_id");

-- CreateIndex
CREATE INDEX "trees_fruit_item_id_idx" ON "trees"("fruit_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "plots_save_id_x_y_key" ON "plots"("save_id", "x", "y");

-- CreateIndex
CREATE INDEX "tiles_crop_id_idx" ON "tiles"("crop_id");

-- CreateIndex
CREATE INDEX "inventory_items_item_id_idx" ON "inventory_items"("item_id");

-- CreateIndex
CREATE INDEX "tree_harvests_tree_id_idx" ON "tree_harvests"("tree_id");

-- AddForeignKey
ALTER TABLE "crops" ADD CONSTRAINT "crops_seed_item_id_fkey" FOREIGN KEY ("seed_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trees" ADD CONSTRAINT "trees_fruit_item_id_fkey" FOREIGN KEY ("fruit_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plots" ADD CONSTRAINT "plots_save_id_fkey" FOREIGN KEY ("save_id") REFERENCES "saves"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_crop_id_fkey" FOREIGN KEY ("crop_id") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_save_id_fkey" FOREIGN KEY ("save_id") REFERENCES "saves"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tree_harvests" ADD CONSTRAINT "tree_harvests_save_id_fkey" FOREIGN KEY ("save_id") REFERENCES "saves"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tree_harvests" ADD CONSTRAINT "tree_harvests_tree_id_fkey" FOREIGN KEY ("tree_id") REFERENCES "trees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Catálogo inicial ----------
-- Itens: sementes (compra) e frutas (venda). O id é o slug usado pelo jogo.
INSERT INTO "items" ("id", "kind", "name", "buy_price", "sell_price", "sort_order") VALUES
  ('corn',       'seed',  'Semente de milho',    7,  NULL, 1),
  ('tomato',     'seed',  'Semente de tomate',   4,  NULL, 2),
  ('pumpkin',    'seed',  'Semente de abóbora',  18, NULL, 3),
  ('carrot',     'seed',  'Semente de cenoura',  5,  NULL, 4),
  ('potato',     'seed',  'Semente de batata',   9,  NULL, 5),
  ('strawberry', 'seed',  'Semente de morango',  12, NULL, 6),
  ('watermelon', 'seed',  'Semente de melancia', 28, NULL, 7),
  ('apple',      'fruit', 'Maçã',                NULL, 6, 1),
  ('orange',     'fruit', 'Laranja',             NULL, 8, 2),
  ('lemon',      'fruit', 'Limão',               NULL, 7, 3);

INSERT INTO "crops" ("id", "name", "grow_seconds", "harvest_price", "seed_item_id") VALUES
  ('corn',       'Milho',    180, 18,  'corn'),
  ('tomato',     'Tomate',   90,  9,   'tomato'),
  ('pumpkin',    'Abóbora',  480, 58,  'pumpkin'),
  ('carrot',     'Cenoura',  120, 12,  'carrot'),
  ('potato',     'Batata',   240, 24,  'potato'),
  ('strawberry', 'Morango',  300, 34,  'strawberry'),
  ('watermelon', 'Melancia', 720, 100, 'watermelon');

-- Posição (linha, coluna no mapa do mundo) de cada árvore; colhe 3 frutas e repõe em 1 hora
INSERT INTO "trees" ("id", "fruit_item_id", "row", "col", "fruits_per_harvest", "regrow_seconds") VALUES
  ('t1', 'apple',  -5,  2,  3, 3600),
  ('t2', 'orange', -4,  11, 3, 3600),
  ('t3', 'lemon',  13,  3,  3, 3600),
  ('t4', 'apple',  12,  13, 3, 3600),
  ('t5', 'orange', 8,   -4, 3, 3600),
  ('t6', 'lemon',  2,   15, 3, 3600);

-- ---------- Regras que o banco garante ----------
-- Só se compra o que tem preço de compra, e só se vende o que tem preço de venda
ALTER TABLE "items" ADD CONSTRAINT "items_kind_price_check" CHECK (
  ("kind" = 'seed' AND "buy_price" IS NOT NULL AND "sell_price" IS NULL) OR
  ("kind" = 'fruit' AND "sell_price" IS NOT NULL AND "buy_price" IS NULL)
);
ALTER TABLE "items" ADD CONSTRAINT "items_prices_check" CHECK ("buy_price" >= 0 AND "sell_price" >= 0);
ALTER TABLE "crops" ADD CONSTRAINT "crops_values_check" CHECK ("grow_seconds" > 0 AND "harvest_price" >= 0);
ALTER TABLE "trees" ADD CONSTRAINT "trees_values_check" CHECK ("fruits_per_harvest" > 0 AND "regrow_seconds" > 0);

ALTER TABLE "tiles" ADD CONSTRAINT "tiles_position_check" CHECK ("row" BETWEEN 0 AND 9 AND "col" BETWEEN 0 AND 9);
-- Tile plantado tem planta e hora do plantio; tile apenas arado não tem nenhum dos dois
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_planted_check" CHECK (
  ("state" = 'planted' AND "crop_id" IS NOT NULL AND "planted_at" IS NOT NULL) OR
  ("state" = 'tilled' AND "crop_id" IS NULL AND "planted_at" IS NULL)
);

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_quantity_check" CHECK ("quantity" > 0);
