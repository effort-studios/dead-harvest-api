import { prisma } from "../../../shared/database/prisma";
import { DAY_LENGTH_SECONDS, DAY_START_SECONDS, GRID_SIZE, PLOT_BASE_PRICE, PLOT_PRICE_FACTOR } from "../game.constants";

// Regras do jogo para o cliente mostrar (preços, tempos, posição das árvores). Só muda com migration,
// então é lido uma vez por processo.
let catalog: ReturnType<typeof loadCatalog> | null = null;

export function getCatalog() {
  catalog ??= loadCatalog().catch((err) => {
    catalog = null; // não guarda a falha
    throw err;
  });
  return catalog;
}

async function loadCatalog() {
  const [crops, fruits, trees] = await Promise.all([
    prisma.crop.findMany({ include: { seedItem: true }, orderBy: { seedItem: { sortOrder: "asc" } } }),
    prisma.item.findMany({ where: { kind: "fruit" }, orderBy: { sortOrder: "asc" } }),
    prisma.tree.findMany({ orderBy: { id: "asc" } }),
  ]);
  return {
    gridSize: GRID_SIZE,
    dayLengthSeconds: DAY_LENGTH_SECONDS,
    dayStartSeconds: DAY_START_SECONDS,
    plotPrice: { base: PLOT_BASE_PRICE, factor: PLOT_PRICE_FACTOR },
    crops: crops.map((c) => ({ id: c.id, name: c.name, growSeconds: c.growSeconds, harvestPrice: c.harvestPrice, seedPrice: c.seedItem.buyPrice ?? 0 })),
    fruits: fruits.map((f) => ({ id: f.id, name: f.name, sellPrice: f.sellPrice ?? 0 })),
    trees: trees.map((t) => ({ id: t.id, fruitId: t.fruitItemId, row: t.row, col: t.col, fruitsPerHarvest: t.fruitsPerHarvest, regrowSeconds: t.regrowSeconds })),
  };
}
