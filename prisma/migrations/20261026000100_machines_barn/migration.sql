-- Armazém, máquinas e celeiro.
--
-- 1. Armazém: colher uma planta não paga mais na hora; dá 1 item de colheita (kind 'crop') que vai para o
--    inventário e é vendido pelo mesmo preço que a colheita pagava (crops.harvest_price vira items.sell_price).
-- 2. Máquinas: lugar fixo no quintal (terreno -1,0, reservado), receitas com ingredientes e tempo; fila por
--    máquina com timestamps (machine_jobs), coletada pelo fazendeiro.
-- 3. Celeiro: baias (saves.barn_capacity) e animais (save_animals) que comem ração e produzem com o tempo.
--
-- Preço dos produtos: valor cru dos ingredientes x (1,2 + 0,15 x dias de jogo), arredondado. 1 dia = 1440 s.

-- ---------- Itens novos ----------

-- Só se compra semente; frutas, colheitas e produtos dos animais sempre se vendem; produto de máquina pode não se vender
ALTER TABLE "items" DROP CONSTRAINT "items_kind_price_check";
ALTER TABLE "items" ADD CONSTRAINT "items_kind_price_check" CHECK (
  ("kind" = 'seed' AND "buy_price" IS NOT NULL AND "sell_price" IS NULL) OR
  ("kind" IN ('fruit', 'crop', 'animal_product') AND "sell_price" IS NOT NULL AND "buy_price" IS NULL) OR
  ("kind" = 'product' AND "buy_price" IS NULL)
);

INSERT INTO "items" ("id", "kind", "name", "buy_price", "sell_price", "sort_order") VALUES
  -- colheitas (mesma ordem das sementes)
  ('corn_harvest',       'crop', 'Milho',    NULL, 57,  1),
  ('tomato_harvest',     'crop', 'Tomate',   NULL, 27,  2),
  ('pumpkin_harvest',    'crop', 'Abóbora',  NULL, 142, 3),
  ('carrot_harvest',     'crop', 'Cenoura',  NULL, 41,  4),
  ('potato_harvest',     'crop', 'Batata',   NULL, 75,  5),
  ('strawberry_harvest', 'crop', 'Morango',  NULL, 96,  6),
  ('watermelon_harvest', 'crop', 'Melancia', NULL, 200, 7),
  -- produtos dos animais
  ('egg',  'animal_product', 'Ovo',   NULL, 45,  1),
  ('milk', 'animal_product', 'Leite', NULL, 90,  2),
  ('wool', 'animal_product', 'Lã',    NULL, 110, 3),
  -- produtos das máquinas (ração e adubo não se vendem: são para usar na fazenda)
  ('feed',                 'product', 'Ração',              NULL, NULL, 1),
  ('fertilizer',           'product', 'Adubo',              NULL, NULL, 2),
  ('apple_juice',          'product', 'Suco de maçã',       NULL, 73,   3),
  ('orange_juice',         'product', 'Suco de laranja',    NULL, 97,   4),
  ('lemonade',             'product', 'Limonada',           NULL, 85,   5),
  ('cornmeal',             'product', 'Fubá',               NULL, 230,  6),
  ('tomato_sauce',         'product', 'Molho de tomate',    NULL, 115,  7),
  ('pickled_carrot',       'product', 'Conserva de cenoura', NULL, 175, 8),
  ('potato_chips',         'product', 'Batata chips',       NULL, 200,  9),
  ('butter',               'product', 'Manteiga',           NULL, 120,  10),
  ('cheese',               'product', 'Queijo',             NULL, 270,  11),
  ('strawberry_jam',       'product', 'Geleia de morango',  NULL, 290,  12),
  ('pumpkin_sweet',        'product', 'Doce de abóbora',    NULL, 425,  13),
  ('yarn',                 'product', 'Novelo de lã',       NULL, 330,  14),
  ('corn_cake',            'product', 'Bolo de fubá',       NULL, 615,  15),
  ('apple_pie',            'product', 'Torta de maçã',      NULL, 605,  16),
  ('strawberry_ice_cream', 'product', 'Sorvete de morango', NULL, 570,  17),
  ('watermelon_sorbet',    'product', 'Sorbet de melancia', NULL, 430,  18),
  ('polenta',              'product', 'Polenta com queijo', NULL, 1015, 19);

-- ---------- Colheita vai para o armazém ----------

ALTER TABLE "crops" ADD COLUMN "harvest_item_id" TEXT;
UPDATE "crops" SET "harvest_item_id" = "id" || '_harvest';
ALTER TABLE "crops" ALTER COLUMN "harvest_item_id" SET NOT NULL;
-- o preço já foi copiado para items.sell_price acima (mesmos valores)
ALTER TABLE "crops" DROP CONSTRAINT "crops_values_check";
ALTER TABLE "crops" DROP COLUMN "harvest_price";
ALTER TABLE "crops" ADD CONSTRAINT "crops_values_check" CHECK ("grow_seconds" > 0);

CREATE UNIQUE INDEX "crops_harvest_item_id_key" ON "crops"("harvest_item_id");
ALTER TABLE "crops" ADD CONSTRAINT "crops_harvest_item_id_fkey" FOREIGN KEY ("harvest_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Adubo no tile arado: a planta que nascer ali cresce mais rápido
ALTER TABLE "tiles" ADD COLUMN "fertilized" BOOLEAN NOT NULL DEFAULT false;

-- ---------- Catálogo: máquinas, receitas, animais ----------

CREATE TABLE "machines" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "buy_price" INTEGER NOT NULL,
    "row" INTEGER NOT NULL,
    "col" INTEGER NOT NULL,
    "queue_size" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "machines_values_check" CHECK ("buy_price" >= 0 AND "queue_size" > 0)
);

CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "output_item_id" TEXT NOT NULL,
    "output_quantity" INTEGER NOT NULL,
    "seconds" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recipes_values_check" CHECK ("output_quantity" > 0 AND "seconds" > 0)
);

CREATE TABLE "recipe_inputs" (
    "recipe_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "recipe_inputs_pkey" PRIMARY KEY ("recipe_id","item_id"),
    CONSTRAINT "recipe_inputs_quantity_check" CHECK ("quantity" > 0)
);

CREATE TABLE "animals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "buy_price" INTEGER NOT NULL,
    "feed_item_id" TEXT NOT NULL,
    "feed_quantity" INTEGER NOT NULL,
    "product_item_id" TEXT NOT NULL,
    "produce_seconds" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "animals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "animals_values_check" CHECK ("buy_price" >= 0 AND "feed_quantity" > 0 AND "produce_seconds" > 0)
);

CREATE INDEX "recipes_machine_id_idx" ON "recipes"("machine_id");
CREATE INDEX "recipes_output_item_id_idx" ON "recipes"("output_item_id");
CREATE INDEX "recipe_inputs_item_id_idx" ON "recipe_inputs"("item_id");
CREATE INDEX "animals_feed_item_id_idx" ON "animals"("feed_item_id");
CREATE INDEX "animals_product_item_id_idx" ON "animals"("product_item_id");

ALTER TABLE "recipes" ADD CONSTRAINT "recipes_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_output_item_id_fkey" FOREIGN KEY ("output_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_inputs" ADD CONSTRAINT "recipe_inputs_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_inputs" ADD CONSTRAINT "recipe_inputs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "animals" ADD CONSTRAINT "animals_feed_item_id_fkey" FOREIGN KEY ("feed_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "animals" ADD CONSTRAINT "animals_product_item_id_fkey" FOREIGN KEY ("product_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Posição no quintal (terreno -1,0: linhas 1..8, colunas -9..-2), em 3 fileiras longe da HUD; as mais baratas
-- ficam perto da plantação
INSERT INTO "machines" ("id", "name", "buy_price", "row", "col", "queue_size", "sort_order") VALUES
  ('juicer',    'Prensa de sucos',    200,  5, -2, 2, 1),
  ('feed_mill', 'Fábrica de ração',   250,  6, -3, 2, 2),
  ('mill',      'Moinho',             300,  4, -4, 2, 3),
  ('cannery',   'Conserveira',        400,  7, -4, 2, 4),
  ('fryer',     'Tacho de fritura',   500,  5, -5, 2, 5),
  ('composter', 'Composteira',        600,  8, -5, 2, 6),
  ('dairy',     'Laticínios',         700,  6, -6, 2, 7),
  ('candy',     'Doceria',            800,  4, -7, 2, 8),
  ('loom',      'Tear',               1000, 7, -7, 2, 9),
  ('oven',      'Forno',              1200, 5, -8, 2, 10),
  ('ice_cream', 'Sorveteira',         1500, 8, -8, 2, 11),
  ('kitchen',   'Cozinha da fazenda', 2500, 6, -9, 2, 12);

--   receita               máquina     sai                      qtd  tempo        ingredientes (valor cru) -> venda
INSERT INTO "recipes" ("id", "machine_id", "output_item_id", "output_quantity", "seconds", "sort_order") VALUES
  ('apple_juice',          'juicer',    'apple_juice',          1, 1440, 1), -- 3 maçãs (54) -> 73
  ('orange_juice',         'juicer',    'orange_juice',         1, 1440, 2), -- 3 laranjas (72) -> 97
  ('lemonade',             'juicer',    'lemonade',             1, 1440, 3), -- 3 limões (63) -> 85
  ('feed',                 'feed_mill', 'feed',                 3, 720,  1), -- milho + cenoura (98) -> 3 rações
  ('cornmeal',             'mill',      'cornmeal',             1, 1440, 1), -- 3 milhos (171) -> 230
  ('tomato_sauce',         'cannery',   'tomato_sauce',         1, 2160, 1), -- 3 tomates (81) -> 115
  ('pickled_carrot',       'cannery',   'pickled_carrot',       1, 2160, 2), -- 3 cenouras (123) -> 175
  ('potato_chips',         'fryer',     'potato_chips',         1, 1440, 1), -- 2 batatas (150) -> 200
  ('fertilizer',           'composter', 'fertilizer',           3, 1440, 1), -- 2 tomates (54) -> 3 adubos
  ('butter',               'dairy',     'butter',               1, 1440, 1), -- leite (90) -> 120
  ('cheese',               'dairy',     'cheese',               1, 2880, 2), -- 2 leites (180) -> 270
  ('strawberry_jam',       'candy',     'strawberry_jam',       1, 2880, 1), -- 2 morangos (192) -> 290
  ('pumpkin_sweet',        'candy',     'pumpkin_sweet',        1, 2880, 2), -- 2 abóboras (284) -> 425
  ('yarn',                 'loom',      'yarn',                 1, 2880, 1), -- 2 lãs (220) -> 330
  ('corn_cake',            'oven',      'corn_cake',            1, 2880, 1), -- fubá + 2 ovos + leite (410) -> 615
  ('apple_pie',            'oven',      'apple_pie',            1, 2880, 2), -- fubá + 3 maçãs + manteiga (404) -> 605
  ('strawberry_ice_cream', 'ice_cream', 'strawberry_ice_cream', 1, 2880, 1), -- leite + geleia (380) -> 570
  ('watermelon_sorbet',    'ice_cream', 'watermelon_sorbet',    1, 2880, 2), -- melancia + limonada (285) -> 430
  ('polenta',              'kitchen',   'polenta',              1, 4320, 1); -- fubá + molho + queijo (615) -> 1015

INSERT INTO "recipe_inputs" ("recipe_id", "item_id", "quantity") VALUES
  ('apple_juice',          'apple',              3),
  ('orange_juice',         'orange',             3),
  ('lemonade',             'lemon',              3),
  ('feed',                 'corn_harvest',       1),
  ('feed',                 'carrot_harvest',     1),
  ('cornmeal',             'corn_harvest',       3),
  ('tomato_sauce',         'tomato_harvest',     3),
  ('pickled_carrot',       'carrot_harvest',     3),
  ('potato_chips',         'potato_harvest',     2),
  ('fertilizer',           'tomato_harvest',     2),
  ('butter',               'milk',               1),
  ('cheese',               'milk',               2),
  ('strawberry_jam',       'strawberry_harvest', 2),
  ('pumpkin_sweet',        'pumpkin_harvest',    2),
  ('yarn',                 'wool',               2),
  ('corn_cake',            'cornmeal',           1),
  ('corn_cake',            'egg',                2),
  ('corn_cake',            'milk',               1),
  ('apple_pie',            'cornmeal',           1),
  ('apple_pie',            'apple',              3),
  ('apple_pie',            'butter',             1),
  ('strawberry_ice_cream', 'milk',               1),
  ('strawberry_ice_cream', 'strawberry_jam',     1),
  ('watermelon_sorbet',    'watermelon_harvest', 1),
  ('watermelon_sorbet',    'lemonade',           1),
  ('polenta',              'cornmeal',           1),
  ('polenta',              'tomato_sauce',       1),
  ('polenta',              'cheese',             1);

INSERT INTO "animals" ("id", "name", "buy_price", "feed_item_id", "feed_quantity", "product_item_id", "produce_seconds", "sort_order") VALUES
  ('chicken', 'Galinha', 150, 'feed', 1, 'egg',  1440, 1),
  ('cow',     'Vaca',    600, 'feed', 2, 'milk', 2880, 2),
  ('sheep',   'Ovelha',  400, 'feed', 2, 'wool', 4320, 3);

-- A árvore t5 ficava no quintal: vai para trás da plantação
UPDATE "trees" SET "row" = -3, "col" = -4 WHERE "id" = 't5';

-- ---------- Estado do jogador ----------

ALTER TABLE "saves" ADD COLUMN "barn_capacity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "saves" ADD CONSTRAINT "saves_barn_capacity_check" CHECK ("barn_capacity" >= 0);

CREATE TABLE "save_machines" (
    "save_id" UUID NOT NULL,
    "machine_id" TEXT NOT NULL,
    "bought_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "save_machines_pkey" PRIMARY KEY ("save_id","machine_id")
);

CREATE TABLE "machine_jobs" (
    "id" UUID NOT NULL,
    "save_id" UUID NOT NULL,
    "machine_id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ready_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "machine_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "machine_jobs_times_check" CHECK ("ready_at" > "starts_at")
);

CREATE TABLE "save_animals" (
    "id" UUID NOT NULL,
    "save_id" UUID NOT NULL,
    "animal_id" TEXT NOT NULL,
    "fed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "save_animals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "save_machines_machine_id_idx" ON "save_machines"("machine_id");
CREATE INDEX "machine_jobs_save_id_machine_id_ready_at_idx" ON "machine_jobs"("save_id", "machine_id", "ready_at");
CREATE INDEX "machine_jobs_recipe_id_idx" ON "machine_jobs"("recipe_id");
CREATE INDEX "save_animals_save_id_idx" ON "save_animals"("save_id");
CREATE INDEX "save_animals_animal_id_idx" ON "save_animals"("animal_id");

ALTER TABLE "save_machines" ADD CONSTRAINT "save_machines_save_id_fkey" FOREIGN KEY ("save_id") REFERENCES "saves"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "save_machines" ADD CONSTRAINT "save_machines_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "machine_jobs" ADD CONSTRAINT "machine_jobs_save_id_fkey" FOREIGN KEY ("save_id") REFERENCES "saves"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "machine_jobs" ADD CONSTRAINT "machine_jobs_save_id_machine_id_fkey" FOREIGN KEY ("save_id", "machine_id") REFERENCES "save_machines"("save_id", "machine_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "machine_jobs" ADD CONSTRAINT "machine_jobs_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "save_animals" ADD CONSTRAINT "save_animals_save_id_fkey" FOREIGN KEY ("save_id") REFERENCES "saves"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "save_animals" ADD CONSTRAINT "save_animals_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Fila do fazendeiro: tarefas novas ----------

ALTER TABLE "farm_jobs" ADD COLUMN "machine_id" TEXT;
-- tile (arar, plantar, colher, adubar): terreno e posição; árvore: id; máquina: id; celeiro: nada além do alvo
ALTER TABLE "farm_jobs" DROP CONSTRAINT "farm_jobs_target_check";
ALTER TABLE "farm_jobs" ADD CONSTRAINT "farm_jobs_target_check" CHECK (
    ("action" = 'harvest_tree' AND "tree_id" IS NOT NULL)
    OR ("action" = 'collect_machine' AND "machine_id" IS NOT NULL)
    OR ("action" = 'collect_barn')
    OR ("action" IN ('till', 'plant', 'harvest', 'fertilize') AND "plot_x" IS NOT NULL AND "plot_y" IS NOT NULL AND "row" IS NOT NULL AND "col" IS NOT NULL)
);
