import { BadRequestError, ConflictError, NotFoundError, UnprocessableError } from "../../../shared/errors/AppError";
import type { TilesInput } from "../dto/game.dto";
import type { GameState } from "../entities/game-state";
import * as repo from "../repositories/game.repository";
import { FERTILIZER_ITEM, GRID_SIZE, plotPrice, WATERING_CAN } from "../utils/game.constants";
import { growthSeconds, settleGrowth } from "../utils/growth";
import { cellsOf } from "../utils/layout";
import { loadState } from "./game-state.service";
import { buildingAreas } from "./layout.service";

// Cada ação do jogador (arar, plantar, colher, adubar, comprar, vender) é validada e aplicada aqui, com os preços
// e tempos do catálogo no banco. Convenção dos erros:
//   400 referência inválida (planta/item que não existe) · 404 terreno/árvore que não existe
//   409 o alvo já está no estado pedido (já arado, terreno já é seu)
//   422 uma regra do jogo não deixa (sem dinheiro, sem semente, planta verde...)

const tileKey = (t: { row: number; col: number }) => `${t.row},${t.col}`;

// Roda a ação com o save do jogador travado, numa transação: se lançar, nada é gravado. Devolve o estado novo.
export type Action = (tx: repo.Tx, save: repo.LockedSave, now: number) => Promise<void>;

export async function act(userId: string, action: Action): Promise<GameState> {
  return repo.transaction(async (tx) => {
    const now = Date.now();
    const save = await repo.lockSave(tx, userId);
    if (!save) throw new NotFoundError("Save não encontrado", "SAVE_NOT_FOUND");
    await action(tx, save, now);
    return loadState(tx, userId, now);
  });
}

async function requirePlot(tx: repo.Tx, saveId: string, x: number, y: number) {
  const plot = await repo.findPlot(tx, saveId, x, y);
  if (!plot) throw new NotFoundError("Terreno não encontrado", "PLOT_NOT_FOUND");
  return plot;
}

// Ara os tiles que ainda são terra (os outros ficam como estão)
// Cada ação de tile/árvore é um `Action` solto (`xxxAction`), para o fazendeiro (farmer.service) rodar na hora em
// que chega ao alvo; as funções exportadas abaixo só embrulham no `act`.
export const tillAction = (input: TilesInput): Action =>
  async (tx, save) => {
    const plot = await requirePlot(tx, save.id, input.x, input.y);
    const used = new Set(plot.tiles.map(tileKey));
    const soil = input.tiles.filter((t) => !used.has(tileKey(t)));
    if (soil.length === 0) throw new ConflictError("Esses tiles já estão arados", "TILES_ALREADY_TILLED");
    // embaixo de prédio não se ara (tiles do terreno, contados a partir do canto dele)
    const built = new Set(
      (await buildingAreas(tx, save)).flatMap(cellsOf).map((c) => tileKey({ row: c.row - input.y * GRID_SIZE, col: c.col - input.x * GRID_SIZE })),
    );
    const free = soil.filter((t) => !built.has(tileKey(t)));
    if (free.length === 0) throw new UnprocessableError("Tem um prédio aí", "TILES_UNDER_BUILDING");
    await repo.createTilledTiles(tx, plot.id, free);
  };

// Planta nos tiles arados, na ordem pedida, enquanto houver semente
export const plantAction = (input: TilesInput & { cropId: string }): Action =>
  async (tx, save, now) => {
    const crop = await repo.findCrop(tx, input.cropId);
    if (!crop) throw new BadRequestError("Planta desconhecida", "UNKNOWN_CROP");
    const plot = await requirePlot(tx, save.id, input.x, input.y);
    const byKey = new Map(plot.tiles.map((t) => [tileKey(t), t]));
    const tilled = input.tiles.filter((t) => byKey.get(tileKey(t))?.state === "tilled");
    if (tilled.length === 0) throw new UnprocessableError("Are a terra antes de plantar", "TILES_NOT_TILLED");

    const have = await repo.itemCount(tx, save.id, crop.seedItemId);
    if (have === 0) throw new UnprocessableError(`Você não tem sementes de ${crop.name.toLowerCase()}`, "NO_SEEDS");
    const chosen = tilled.slice(0, have);
    await repo.plantTiles(tx, plot.id, chosen, crop.id, new Date(now));
    await repo.removeItem(tx, save.id, crop.seedItemId, chosen.length, have);
  };

// Colhe os tiles com planta madura (crescimento conferido pelo relógio do servidor): cada um dá 1 item de
// colheita, que vai para o armazém (inventário) e é vendido ou usado nas máquinas
export const harvestAction = (input: TilesInput): Action =>
  async (tx, save, now) => {
    const plot = await requirePlot(tx, save.id, input.x, input.y);
    const byKey = new Map(plot.tiles.map((t) => [tileKey(t), t]));
    const ripe = input.tiles.flatMap((pos) => {
      const t = byKey.get(tileKey(pos));
      const grown = t?.state === "planted" && t.crop && growthSeconds(t, now) >= t.crop.growSeconds;
      return grown ? [{ row: t.row, col: t.col, itemId: t.crop!.harvestItemId }] : [];
    });
    if (ripe.length === 0) throw new UnprocessableError("A planta ainda não está madura", "CROP_NOT_RIPE");

    await repo.clearTiles(tx, plot.id, ripe);
    const counts = new Map<string, number>();
    for (const t of ripe) counts.set(t.itemId, (counts.get(t.itemId) ?? 0) + 1);
    for (const [itemId, n] of counts) await repo.addItem(tx, save.id, itemId, n);
  };

type PlotTile = NonNullable<Awaited<ReturnType<typeof repo.findPlot>>>["tiles"][number];

// Tiles pedidos que dá para adubar ou regar: terra arada ou com planta, ainda sem esse bônus
function boostable(plot: { tiles: PlotTile[] }, input: TilesInput, already: (t: PlotTile) => boolean, what: { verb: string; code: string }) {
  const byKey = new Map(plot.tiles.map((t) => [tileKey(t), t]));
  const soil = input.tiles.map((pos) => byKey.get(tileKey(pos))).filter((t): t is PlotTile => t !== undefined);
  if (soil.length === 0) throw new UnprocessableError(`Só dá para ${what.verb} terra arada ou plantada`, "TILES_NOT_TILLED");
  const fresh = soil.filter((t) => !already(t));
  if (fresh.length === 0) throw new ConflictError(`Esses tiles já estão ${what.verb === "adubar" ? "adubados" : "regados"}`, what.code);
  return fresh;
}

// Com planta crescendo, grava o crescimento até agora antes do bônus mudar a velocidade (utils/growth)
const settled = (t: PlotTile, now: number) => (t.state === "planted" ? { row: t.row, col: t.col, ...settleGrowth(t, now) } : { row: t.row, col: t.col });

// Aduba os tiles (arados ou já plantados) que não estão adubados, enquanto houver adubo
export const fertilizeAction = (input: TilesInput): Action =>
  async (tx, save, now) => {
    const plot = await requirePlot(tx, save.id, input.x, input.y);
    const fresh = boostable(plot, input, (t) => t.fertilized, { verb: "adubar", code: "TILES_ALREADY_FERTILIZED" });
    const have = await repo.itemCount(tx, save.id, FERTILIZER_ITEM);
    if (have === 0) throw new UnprocessableError("Você não tem adubo (faça na Composteira)", "NO_FERTILIZER");
    const chosen = fresh.slice(0, have);
    for (const t of chosen) await repo.boostTile(tx, plot.id, settled(t, now), { fertilized: true });
    await repo.removeItem(tx, save.id, FERTILIZER_ITEM, chosen.length, have);
  };

// Rega os tiles (arados ou já plantados) que não estão regados, 1 carga do regador por tile
export const waterAction = (input: TilesInput): Action =>
  async (tx, save, now) => {
    if (save.canCharges === null) throw new UnprocessableError("Compre o regador na loja", "NO_CAN");
    const plot = await requirePlot(tx, save.id, input.x, input.y);
    const fresh = boostable(plot, input, (t) => t.watered, { verb: "regar", code: "TILES_ALREADY_WATERED" });
    if (save.canCharges === 0) throw new UnprocessableError("O regador está vazio: encha no poço", "CAN_EMPTY");
    const chosen = fresh.slice(0, save.canCharges);
    for (const t of chosen) await repo.boostTile(tx, plot.id, settled(t, now), { watered: true });
    await repo.setCanCharges(tx, save.id, save.canCharges - chosen.length);
  };

// Regador: compra uma vez, vem cheio
export const buyCan = (userId: string) =>
  act(userId, async (tx, save) => {
    if (save.canCharges !== null) throw new ConflictError("Você já tem o regador", "CAN_ALREADY_OWNED");
    if (save.money < WATERING_CAN.price) throw new UnprocessableError("Dinheiro insuficiente", "INSUFFICIENT_FUNDS");
    await repo.setCanCharges(tx, save.id, WATERING_CAN.charges);
    await repo.changeMoney(tx, save.id, -WATERING_CAN.price);
  });

// Compra sementes; se o dinheiro não dá para todas, compra as que dá
export const buySeed = (userId: string, input: { cropId: string; quantity: number }) =>
  act(userId, async (tx, save) => {
    const crop = await repo.findCropWithSeed(tx, input.cropId);
    const price = crop?.seedItem.buyPrice;
    if (!crop || price == null) throw new BadRequestError("Semente desconhecida", "UNKNOWN_SEED");
    const n = price === 0 ? input.quantity : Math.min(input.quantity, Math.floor(save.money / price));
    if (n < 1) throw new UnprocessableError("Dinheiro insuficiente", "INSUFFICIENT_FUNDS");
    await repo.changeMoney(tx, save.id, -price * n);
    await repo.addItem(tx, save.id, crop.seedItemId, n);
  });

// Vende um item do armazém (todos, se a quantidade não vier): frutas, colheitas, produtos
export const sellItem = (userId: string, input: { itemId: string; quantity?: number }) =>
  act(userId, async (tx, save) => {
    const item = await repo.findItem(tx, input.itemId);
    if (!item || item.sellPrice == null) throw new BadRequestError("Esse item não se vende", "ITEM_NOT_SELLABLE");
    const have = await repo.itemCount(tx, save.id, item.id);
    const n = Math.min(input.quantity ?? have, have);
    if (n < 1) throw new UnprocessableError(`Você não tem ${item.name.toLowerCase()}`, "NOT_ENOUGH_ITEMS");
    await repo.removeItem(tx, save.id, item.id, n, have);
    await repo.changeMoney(tx, save.id, item.sellPrice * n);
  });

// Compra um terreno vazio colado (4 direções) a um que o jogador já tem
export const buyPlot = (userId: string, input: { x: number; y: number }) =>
  act(userId, async (tx, save) => {
    const plots = await repo.findPlotPositions(tx, save.id);
    if (plots.some((p) => p.x === input.x && p.y === input.y)) throw new ConflictError("Esse terreno já é seu", "PLOT_ALREADY_OWNED");
    const touches = plots.some((p) => Math.abs(p.x - input.x) + Math.abs(p.y - input.y) === 1);
    if (!touches) throw new UnprocessableError("Só dá para comprar um terreno ao lado de um seu", "PLOT_NOT_ADJACENT");
    const price = plotPrice(plots.length);
    if (save.money < price) throw new UnprocessableError("Dinheiro insuficiente", "INSUFFICIENT_FUNDS");
    await repo.createPlot(tx, save.id, input.x, input.y);
    await repo.changeMoney(tx, save.id, -price);
  });

// Colhe as frutas de uma árvore; ela só repõe depois do tempo de rebrota
export const harvestTreeAction = (treeId: string): Action =>
  async (tx, save, now) => {
    const tree = await repo.findTree(tx, treeId);
    if (!tree) throw new NotFoundError("Árvore não encontrada", "TREE_NOT_FOUND");
    const last = await repo.findTreeHarvest(tx, save.id, treeId);
    if (last && now - last.harvestedAt.getTime() < tree.regrowSeconds * 1000) {
      throw new UnprocessableError("A árvore ainda não repôs as frutas", "TREE_NOT_READY");
    }
    await repo.saveTreeHarvest(tx, save.id, treeId, new Date(now));
    await repo.addItem(tx, save.id, tree.fruitItemId, tree.fruitsPerHarvest);
  };

export const till = (userId: string, input: TilesInput) => act(userId, tillAction(input));
export const plant = (userId: string, input: TilesInput & { cropId: string }) => act(userId, plantAction(input));
export const harvest = (userId: string, input: TilesInput) => act(userId, harvestAction(input));
export const fertilize = (userId: string, input: TilesInput) => act(userId, fertilizeAction(input));
export const water = (userId: string, input: TilesInput) => act(userId, waterAction(input));
export const harvestTree = (userId: string, treeId: string) => act(userId, harvestTreeAction(treeId));
