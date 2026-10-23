import type { Prisma } from "@prisma/client";
import { prisma } from "../../../shared/database/prisma";

// Único lugar do módulo game que fala com o Prisma. As funções que recebem `db` funcionam dentro ou fora
// de uma transação; as que recebem `tx` só rodam dentro de uma (ver `transaction` e `lockSave`).

export type Tx = Prisma.TransactionClient;
export type Db = Tx | typeof prisma;
export type LockedSave = { id: string; money: number };
export type TilePos = { row: number; col: number };

// ---------- Transação ----------

// Conexão padrão, para leituras fora de uma transação
export const defaultDb: Db = prisma;

export const transaction = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction(fn);

// Trava a linha do save (FOR UPDATE): ações ao mesmo tempo (cliques rápidos, duas abas, dois aparelhos)
// entram em fila e cada uma vê o resultado da anterior.
export async function lockSave(tx: Tx, userId: string): Promise<LockedSave | null> {
  const [save] = await tx.$queryRaw<LockedSave[]>`SELECT id, money FROM saves WHERE user_id = ${userId}::uuid FOR UPDATE`;
  return save ?? null;
}

// ---------- Leitura do estado e do catálogo ----------

export const findSaveState = (db: Db, userId: string) =>
  db.save.findUnique({
    where: { userId },
    include: { plots: { include: { tiles: true }, orderBy: [{ y: "asc" }, { x: "asc" }] }, inventory: true, treeHarvests: true },
  });

export async function findCatalogData() {
  const [crops, fruits, trees] = await Promise.all([
    prisma.crop.findMany({ include: { seedItem: true }, orderBy: { seedItem: { sortOrder: "asc" } } }),
    prisma.item.findMany({ where: { kind: "fruit" }, orderBy: { sortOrder: "asc" } }),
    prisma.tree.findMany({ orderBy: { id: "asc" } }),
  ]);
  return { crops, fruits, trees };
}

// ---------- Terrenos e tiles ----------

export const findPlot = (tx: Tx, saveId: string, x: number, y: number) =>
  tx.plot.findUnique({ where: { saveId_x_y: { saveId, x, y } }, include: { tiles: { include: { crop: true } } } });

export const findPlotPositions = (tx: Tx, saveId: string) => tx.plot.findMany({ where: { saveId }, select: { x: true, y: true } });

export const createPlot = (tx: Tx, saveId: string, x: number, y: number) => tx.plot.create({ data: { saveId, x, y } });

export const createTilledTiles = (tx: Tx, plotId: string, tiles: TilePos[]) =>
  tx.tile.createMany({ data: tiles.map((t) => ({ plotId, row: t.row, col: t.col, state: "tilled" as const })) });

export const plantTiles = (tx: Tx, plotId: string, tiles: TilePos[], cropId: string, plantedAt: Date) =>
  tx.tile.updateMany({
    where: { plotId, OR: tiles.map((t) => ({ row: t.row, col: t.col })) },
    data: { state: "planted", cropId, plantedAt },
  });

// Volta os tiles para "arado" (depois da colheita)
export const clearTiles = (tx: Tx, plotId: string, tiles: TilePos[]) =>
  tx.tile.updateMany({
    where: { plotId, OR: tiles.map((t) => ({ row: t.row, col: t.col })) },
    data: { state: "tilled", cropId: null, plantedAt: null },
  });

// ---------- Dinheiro e inventário ----------

export const changeMoney = (tx: Tx, saveId: string, amount: number) =>
  tx.save.update({ where: { id: saveId }, data: { money: { increment: amount } } });

export async function itemCount(tx: Tx, saveId: string, itemId: string) {
  const row = await tx.inventoryItem.findUnique({ where: { saveId_itemId: { saveId, itemId } } });
  return row?.quantity ?? 0;
}

export const addItem = (tx: Tx, saveId: string, itemId: string, quantity: number) =>
  tx.inventoryItem.upsert({
    where: { saveId_itemId: { saveId, itemId } },
    create: { saveId, itemId, quantity },
    update: { quantity: { increment: quantity } },
  });

// Tira do inventário; quem chama já conferiu que há o bastante. Zerou, a linha some (o banco não aceita 0).
export async function removeItem(tx: Tx, saveId: string, itemId: string, quantity: number, have: number) {
  const where = { saveId_itemId: { saveId, itemId } };
  if (have === quantity) await tx.inventoryItem.delete({ where });
  else await tx.inventoryItem.update({ where, data: { quantity: { decrement: quantity } } });
}

// ---------- Catálogo (consultas dentro da ação) ----------

export const findCrop = (tx: Tx, id: string) => tx.crop.findUnique({ where: { id } });
export const findCropWithSeed = (tx: Tx, id: string) => tx.crop.findUnique({ where: { id }, include: { seedItem: true } });
export const findItem = (tx: Tx, id: string) => tx.item.findUnique({ where: { id } });
export const findTree = (tx: Tx, id: string) => tx.tree.findUnique({ where: { id } });

// ---------- Árvores ----------

export const findTreeHarvest = (tx: Tx, saveId: string, treeId: string) =>
  tx.treeHarvest.findUnique({ where: { saveId_treeId: { saveId, treeId } } });

export const saveTreeHarvest = (tx: Tx, saveId: string, treeId: string, harvestedAt: Date) =>
  tx.treeHarvest.upsert({
    where: { saveId_treeId: { saveId, treeId } },
    create: { saveId, treeId, harvestedAt },
    update: { harvestedAt },
  });
