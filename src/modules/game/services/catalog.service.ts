import { config } from "../../../config";
import * as gameRepository from "../repositories/game.repository";
import { BARN_FOOTPRINT, WELL_FOOTPRINT } from "../utils/layout";
import {
  BARN,
  DAY_LENGTH_SECONDS,
  DAY_START_SECONDS,
  FERTILIZER_ITEM,
  GROWTH_BONUS,
  GRID_SIZE,
  PLOT_BASE_PRICE,
  PLOT_PRICE_FACTOR,
  WATERING_CAN,
  WELL,
} from "../utils/game.constants";

// Regras do jogo para o cliente mostrar (preços, tempos, posição das árvores e das máquinas, receitas,
// animais). Só muda com migration,
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
  const { crops, items, trees, machines, animals } = await gameRepository.findCatalogData();
  return {
    gridSize: GRID_SIZE,
    farmerWalkSpeed: config.farmerWalkSpeed, // células por segundo (o cliente anda livre nessa velocidade)
    dayLengthSeconds: DAY_LENGTH_SECONDS,
    dayStartSeconds: DAY_START_SECONDS,
    plotPrice: { base: PLOT_BASE_PRICE, factor: PLOT_PRICE_FACTOR },
    // chão do celeiro (em células, a partir da dele; a máquina ocupa size x size)
    layout: { barnFootprint: BARN_FOOTPRINT, wellFootprint: WELL_FOOTPRINT },
    // harvestPrice = preço de venda da colheita (harvestItemId) no armazém
    crops: crops.map((c) => ({
      id: c.id,
      name: c.name,
      growSeconds: c.growSeconds,
      harvestItemId: c.harvestItemId,
      harvestPrice: c.harvestItem.sellPrice ?? 0,
      seedPrice: c.seedItem.buyPrice ?? 0,
    })),
    fruits: items.filter((i) => i.kind === "fruit").map((f) => ({ id: f.id, name: f.name, sellPrice: f.sellPrice ?? 0 })),
    // tudo que não é semente (frutas, colheitas, produtos); sellPrice null = não se vende
    items: items.map((i) => ({ id: i.id, kind: i.kind, name: i.name, sellPrice: i.sellPrice })),
    trees: trees.map((t) => ({ id: t.id, fruitId: t.fruitItemId, row: t.row, col: t.col, fruitsPerHarvest: t.fruitsPerHarvest, regrowSeconds: t.regrowSeconds })),
    machines: machines.map((m) => ({
      id: m.id,
      name: m.name,
      buyPrice: m.buyPrice,
      size: m.size,
      queueSize: m.queueSize,
      recipes: m.recipes.map((r) => ({
        id: r.id,
        outputItemId: r.outputItemId,
        outputQuantity: r.outputQuantity,
        seconds: r.seconds,
        inputs: r.inputs.map((i) => ({ itemId: i.itemId, quantity: i.quantity })),
      })),
    })),
    animals: animals.map((a) => ({
      id: a.id,
      name: a.name,
      buyPrice: a.buyPrice,
      feedItemId: a.feedItemId,
      feedQuantity: a.feedQuantity,
      productItemId: a.productItemId,
      produceSeconds: a.produceSeconds,
      // o que ele solta junto a cada coleta (esterco); null = nada
      byproductItemId: a.byproductItemId,
      byproductQuantity: a.byproductQuantity,
    })),
    barn: {
      price: BARN.price,
      startCapacity: BARN.startCapacity,
      expandBy: BARN.expandBy,
      maxCapacity: BARN.maxCapacity,
      expandPrice: { base: BARN.expandBasePrice, factor: BARN.expandFactor },
    },
    fertilizer: { itemId: FERTILIZER_ITEM },
    // quanto cada um acelera a planta (somam): 0,3 = 30% mais rápido
    growthBonus: GROWTH_BONUS,
    wateringCan: WATERING_CAN,
    well: WELL,
  };
}
