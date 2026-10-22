import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { DAY_LENGTH_SECONDS, DAY_START_SECONDS, GRID_SIZE, PLOT_BASE_PRICE, PLOT_PRICE_FACTOR, plotPrice } from "../game/constants";
import type { TilesInput } from "../schemas/game";

// O servidor é a fonte da verdade: cada ação do jogador (arar, plantar, colher, comprar, vender) é
// validada e aplicada aqui, com os preços e tempos do catálogo no banco. O cliente só recebe o
// estado resultante; o que ele mostra entre uma resposta e outra é só previsão.

// Ação recusada pelas regras do jogo (sem dinheiro, planta verde...). A mensagem vai para o jogador.
export class GameError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;

export type TileView = { state: "soil" | "tilled" | "planted"; crop: string | null; growth: number };

export type GameState = {
  serverTime: number; // ms; o cliente usa para acertar o relógio dele (frutas, crescimento)
  day: number;
  time: number; // segundos desde o início do dia
  money: number;
  plots: { x: number; y: number; grid: TileView[][] }[];
  inventory: Record<string, number>;
  trees: Record<string, number>; // id da árvore -> ms da última colheita
};

// ---------- Leitura ----------

const emptyGrid = (): TileView[][] =>
  Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ state: "soil" as const, crop: null, growth: 0 })),
  );

const seconds = (ms: number) => Math.max(0, Math.floor(ms / 1000));

async function loadState(db: Db, userId: string, now: number): Promise<GameState | null> {
  const save = await db.save.findUnique({
    where: { userId },
    include: { plots: { include: { tiles: true }, orderBy: [{ y: "asc" }, { x: "asc" }] }, inventory: true, treeHarvests: true },
  });
  if (!save) return null;

  // Dia e hora do jogo vêm do relógio do servidor
  const elapsed = seconds(now - save.gameStartedAt.getTime());

  return {
    serverTime: now,
    day: Math.floor(elapsed / DAY_LENGTH_SECONDS) + 1,
    time: elapsed % DAY_LENGTH_SECONDS,
    money: save.money,
    plots: save.plots.map((plot) => {
      const grid = emptyGrid();
      for (const t of plot.tiles) {
        grid[t.row][t.col] =
          t.state === "planted" && t.plantedAt
            ? { state: "planted", crop: t.cropId, growth: seconds(now - t.plantedAt.getTime()) }
            : { state: "tilled", crop: null, growth: 0 };
      }
      return { x: plot.x, y: plot.y, grid };
    }),
    inventory: Object.fromEntries(save.inventory.map((i) => [i.itemId, i.quantity])),
    trees: Object.fromEntries(save.treeHarvests.map((h) => [h.treeId, h.harvestedAt.getTime()])),
  };
}

export function getState(userId: string) {
  return loadState(prisma, userId, Date.now());
}

// ---------- Catálogo ----------

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

// ---------- Ações ----------

type LockedSave = { id: string; money: number };

// Roda a ação com o save do jogador travado (FOR UPDATE): ações ao mesmo tempo (cliques rápidos, duas
// abas, dois aparelhos) entram em fila e cada uma vê o resultado da anterior. Devolve o estado novo.
async function act(userId: string, action: (tx: Tx, save: LockedSave, now: number) => Promise<void>): Promise<GameState> {
  return prisma.$transaction(async (tx) => {
    const now = Date.now();
    const [save] = await tx.$queryRaw<LockedSave[]>`SELECT id, money FROM saves WHERE user_id = ${userId}::uuid FOR UPDATE`;
    if (!save) throw new GameError("Save não encontrado", 404);
    await action(tx, save, now);
    return (await loadState(tx, userId, now))!;
  });
}

async function findPlot(tx: Tx, saveId: string, x: number, y: number) {
  const plot = await tx.plot.findUnique({ where: { saveId_x_y: { saveId, x, y } }, include: { tiles: { include: { crop: true } } } });
  if (!plot) throw new GameError("Terreno não encontrado", 404);
  return plot;
}

const key = (t: { row: number; col: number }) => `${t.row},${t.col}`;

const changeMoney = (tx: Tx, saveId: string, amount: number) =>
  tx.save.update({ where: { id: saveId }, data: { money: { increment: amount } } });

async function itemCount(tx: Tx, saveId: string, itemId: string) {
  const row = await tx.inventoryItem.findUnique({ where: { saveId_itemId: { saveId, itemId } } });
  return row?.quantity ?? 0;
}

const addItem = (tx: Tx, saveId: string, itemId: string, quantity: number) =>
  tx.inventoryItem.upsert({
    where: { saveId_itemId: { saveId, itemId } },
    create: { saveId, itemId, quantity },
    update: { quantity: { increment: quantity } },
  });

// Tira do inventário; quem chama já conferiu que há o bastante. Zerou, a linha some (o banco não aceita 0).
async function removeItem(tx: Tx, saveId: string, itemId: string, quantity: number, have: number) {
  const where = { saveId_itemId: { saveId, itemId } };
  if (have === quantity) await tx.inventoryItem.delete({ where });
  else await tx.inventoryItem.update({ where, data: { quantity: { decrement: quantity } } });
}

// Ara os tiles que ainda são terra (os outros ficam como estão)
export const till = (userId: string, input: TilesInput) =>
  act(userId, async (tx, save) => {
    const plot = await findPlot(tx, save.id, input.x, input.y);
    const used = new Set(plot.tiles.map(key));
    const soil = input.tiles.filter((t) => !used.has(key(t)));
    if (soil.length === 0) throw new GameError("Esses tiles já estão arados");
    await tx.tile.createMany({ data: soil.map((t) => ({ plotId: plot.id, row: t.row, col: t.col, state: "tilled" as const })) });
  });

// Planta nos tiles arados, na ordem pedida, enquanto houver semente
export const plant = (userId: string, input: TilesInput & { cropId: string }) =>
  act(userId, async (tx, save, now) => {
    const crop = await tx.crop.findUnique({ where: { id: input.cropId } });
    if (!crop) throw new GameError("Planta desconhecida", 400);
    const plot = await findPlot(tx, save.id, input.x, input.y);
    const byKey = new Map(plot.tiles.map((t) => [key(t), t]));
    const tilled = input.tiles.filter((t) => byKey.get(key(t))?.state === "tilled");
    if (tilled.length === 0) throw new GameError("Are a terra antes de plantar");

    const have = await itemCount(tx, save.id, crop.seedItemId);
    if (have === 0) throw new GameError(`Você não tem sementes de ${crop.name.toLowerCase()}`);
    const chosen = tilled.slice(0, have);
    await tx.tile.updateMany({
      where: { plotId: plot.id, OR: chosen.map((t) => ({ row: t.row, col: t.col })) },
      data: { state: "planted", cropId: crop.id, plantedAt: new Date(now) },
    });
    await removeItem(tx, save.id, crop.seedItemId, chosen.length, have);
  });

// Colhe os tiles com planta madura (crescimento conferido pelo relógio do servidor)
export const harvest = (userId: string, input: TilesInput) =>
  act(userId, async (tx, save, now) => {
    const plot = await findPlot(tx, save.id, input.x, input.y);
    const byKey = new Map(plot.tiles.map((t) => [key(t), t]));
    const ripe = input.tiles
      .map((t) => byKey.get(key(t)))
      .filter((t) => t?.state === "planted" && t.crop && t.plantedAt && now - t.plantedAt.getTime() >= t.crop.growSeconds * 1000);
    if (ripe.length === 0) throw new GameError("A planta ainda não está madura");

    await tx.tile.updateMany({
      where: { plotId: plot.id, OR: ripe.map((t) => ({ row: t!.row, col: t!.col })) },
      data: { state: "tilled", cropId: null, plantedAt: null },
    });
    await changeMoney(tx, save.id, ripe.reduce((sum, t) => sum + t!.crop!.harvestPrice, 0));
  });

// Compra sementes; se o dinheiro não dá para todas, compra as que dá
export const buySeed = (userId: string, input: { cropId: string; quantity: number }) =>
  act(userId, async (tx, save) => {
    const crop = await tx.crop.findUnique({ where: { id: input.cropId }, include: { seedItem: true } });
    const price = crop?.seedItem.buyPrice;
    if (!crop || price == null) throw new GameError("Semente desconhecida", 400);
    const n = price === 0 ? input.quantity : Math.min(input.quantity, Math.floor(save.money / price));
    if (n < 1) throw new GameError("Dinheiro insuficiente");
    await changeMoney(tx, save.id, -price * n);
    await addItem(tx, save.id, crop.seedItemId, n);
  });

// Vende frutas do inventário (todas, se a quantidade não vier)
export const sellFruit = (userId: string, input: { itemId: string; quantity?: number }) =>
  act(userId, async (tx, save) => {
    const item = await tx.item.findUnique({ where: { id: input.itemId } });
    if (!item || item.sellPrice == null) throw new GameError("Esse item não se vende", 400);
    const have = await itemCount(tx, save.id, item.id);
    const n = Math.min(input.quantity ?? have, have);
    if (n < 1) throw new GameError(`Você não tem ${item.name.toLowerCase()}`);
    await removeItem(tx, save.id, item.id, n, have);
    await changeMoney(tx, save.id, item.sellPrice * n);
  });

// Compra um terreno vazio colado (4 direções) a um que o jogador já tem
export const buyPlot = (userId: string, input: { x: number; y: number }) =>
  act(userId, async (tx, save) => {
    const plots = await tx.plot.findMany({ where: { saveId: save.id }, select: { x: true, y: true } });
    if (plots.some((p) => p.x === input.x && p.y === input.y)) throw new GameError("Esse terreno já é seu");
    const touches = plots.some((p) => Math.abs(p.x - input.x) + Math.abs(p.y - input.y) === 1);
    if (!touches) throw new GameError("Só dá para comprar um terreno ao lado de um seu");
    const price = plotPrice(plots.length);
    if (save.money < price) throw new GameError("Dinheiro insuficiente");
    await tx.plot.create({ data: { saveId: save.id, x: input.x, y: input.y } });
    await changeMoney(tx, save.id, -price);
  });

// Colhe as frutas de uma árvore; ela só repõe depois do tempo de rebrota
export const harvestTree = (userId: string, treeId: string) =>
  act(userId, async (tx, save, now) => {
    const tree = await tx.tree.findUnique({ where: { id: treeId } });
    if (!tree) throw new GameError("Árvore não encontrada", 404);
    const where = { saveId_treeId: { saveId: save.id, treeId } };
    const last = await tx.treeHarvest.findUnique({ where });
    if (last && now - last.harvestedAt.getTime() < tree.regrowSeconds * 1000) throw new GameError("A árvore ainda não repôs as frutas");
    await tx.treeHarvest.upsert({ where, create: { saveId: save.id, treeId, harvestedAt: new Date(now) }, update: { harvestedAt: new Date(now) } });
    await addItem(tx, save.id, tree.fruitItemId, tree.fruitsPerHarvest);
  });
