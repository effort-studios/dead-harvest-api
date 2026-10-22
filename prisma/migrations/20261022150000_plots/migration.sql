-- grid (um mapa 10x10) vira plots (lista de terrenos); o mapa existente vira o terreno 0,0
ALTER TABLE "Save" RENAME COLUMN "grid" TO "plots";
UPDATE "Save" SET "plots" = jsonb_build_array(jsonb_build_object('x', 0, 'y', 0, 'grid', "plots"));
