-- Esterco: galinha e vaca soltam esterco junto com o produto (o fazendeiro recolhe na coleta do celeiro) e a
-- Composteira transforma em adubo. O adubo passa a fazer a planta crescer 30% mais rápido (game.constants).

INSERT INTO "items" ("id", "kind", "name", "buy_price", "sell_price", "sort_order") VALUES
  ('manure', 'animal_product', 'Esterco', NULL, 5, 4);

-- Subproduto do animal: o que ele solta a cada coleta, além do produto (nulo = nada)
ALTER TABLE "animals" ADD COLUMN "byproduct_item_id" TEXT, ADD COLUMN "byproduct_quantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "animals" ADD CONSTRAINT "animals_byproduct_item_id_fkey" FOREIGN KEY ("byproduct_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "animals" ADD CONSTRAINT "animals_byproduct_check"
  CHECK (("byproduct_item_id" IS NULL AND "byproduct_quantity" = 0) OR ("byproduct_item_id" IS NOT NULL AND "byproduct_quantity" > 0));
CREATE INDEX "animals_byproduct_item_id_idx" ON "animals"("byproduct_item_id");
UPDATE "animals" SET "byproduct_item_id" = 'manure', "byproduct_quantity" = 1 WHERE "id" = 'chicken';
UPDATE "animals" SET "byproduct_item_id" = 'manure', "byproduct_quantity" = 2 WHERE "id" = 'cow';

-- Composteira: 2 estercos -> 3 adubos (a de tomate continua)
INSERT INTO "recipes" ("id", "machine_id", "output_item_id", "output_quantity", "seconds", "sort_order") VALUES
  ('manure_fertilizer', 'composter', 'fertilizer', 3, 1440, 2);
INSERT INTO "recipe_inputs" ("recipe_id", "item_id", "quantity") VALUES
  ('manure_fertilizer', 'manure', 2);
