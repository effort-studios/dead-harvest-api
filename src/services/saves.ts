import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { DAY_LENGTH_SECONDS, GRID_SIZE } from "../game/constants";
import type { SaveData } from "../schemas/save";

// Formato de save que o front usa hoje, montado a partir das tabelas (plots, tiles, inventory_items...).
// O estado do jogo vive nas tabelas; este formato é só a "vista" transitória enquanto as ações
// (arar, plantar, colher, comprar...) não são feitas direto no servidor.
export type SaveView = SaveData & { updatedAt: Date };

export class InvalidSaveError extends Error {}

type Db = Prisma.TransactionClient | typeof prisma;

type Tile = SaveData["plots"][number]["grid"][number][number];

const emptyGrid = (): Tile[][] =>
  Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ state: "soil", crop: null, growth: 0 })),
  );

async function loadView(db: Db, userId: string, now: number): Promise<SaveView | null> {
  const save = await db.save.findUnique({
    where: { userId },
    include: { plots: { include: { tiles: true } }, inventory: true, treeHarvests: true },
  });
  if (!save) return null;

  // Dia e hora do jogo vêm do relógio do servidor
  const elapsed = Math.max(0, Math.floor((now - save.gameStartedAt.getTime()) / 1000));

  return {
    day: Math.floor(elapsed / DAY_LENGTH_SECONDS) + 1,
    time: elapsed % DAY_LENGTH_SECONDS,
    money: save.money,
    plots: save.plots.map((plot) => {
      const grid = emptyGrid();
      for (const t of plot.tiles) {
        grid[t.row][t.col] =
          t.state === "planted" && t.plantedAt
            ? { state: "planted", crop: t.cropId, growth: Math.max(0, Math.floor((now - t.plantedAt.getTime()) / 1000)) }
            : { state: "tilled", crop: null, growth: 0 };
      }
      return { x: plot.x, y: plot.y, grid };
    }),
    inventory: Object.fromEntries(save.inventory.map((i) => [i.itemId, i.quantity])),
    trees: Object.fromEntries(save.treeHarvests.map((h) => [h.treeId, h.harvestedAt.getTime()])),
    updatedAt: save.updatedAt,
  };
}

export function getSave(userId: string) {
  return loadView(prisma, userId, Date.now());
}

// Grava o save recebido nas tabelas. Retorna null se o usuário não tem save.
// Planta, árvore e relógio do jogo viram timestamps do servidor (crescimento = agora - planted_at).
export async function updateSave(userId: string, data: SaveData): Promise<SaveView | null> {
  const now = Date.now();
  try {
    return await prisma.$transaction(async (tx) => {
      const save = await tx.save.findUnique({ where: { userId }, select: { id: true } });
      if (!save) return null;

      await tx.save.update({
        where: { id: save.id },
        data: {
          money: data.money,
          gameStartedAt: new Date(now - ((data.day - 1) * DAY_LENGTH_SECONDS + data.time) * 1000),
        },
      });

      // Terrenos: recria tudo (os tiles caem em cascata)
      await tx.plot.deleteMany({ where: { saveId: save.id } });
      const plots = data.plots.map((p) => ({ id: randomUUID(), ...p }));
      await tx.plot.createMany({ data: plots.map((p) => ({ id: p.id, saveId: save.id, x: p.x, y: p.y })) });
      const tiles: Prisma.TileCreateManyInput[] = [];
      for (const p of plots) {
        p.grid.forEach((line, row) =>
          line.forEach((tile, col) => {
            if (tile.state === "soil") return; // terra sem arar não tem linha
            if (tile.state === "tilled") {
              tiles.push({ plotId: p.id, row, col, state: "tilled" });
            } else if (tile.crop) {
              tiles.push({ plotId: p.id, row, col, state: "planted", cropId: tile.crop, plantedAt: new Date(now - tile.growth * 1000) });
            } else {
              throw new InvalidSaveError("Tile plantado sem planta");
            }
          }),
        );
      }
      await tx.tile.createMany({ data: tiles });

      await tx.inventoryItem.deleteMany({ where: { saveId: save.id } });
      await tx.inventoryItem.createMany({
        data: Object.entries(data.inventory)
          .filter(([, quantity]) => quantity > 0)
          .map(([itemId, quantity]) => ({ saveId: save.id, itemId, quantity })),
      });

      await tx.treeHarvest.deleteMany({ where: { saveId: save.id } });
      await tx.treeHarvest.createMany({
        data: Object.entries(data.trees).map(([treeId, ms]) => ({ saveId: save.id, treeId, harvestedAt: new Date(ms) })),
      });

      return loadView(tx, userId, now);
    });
  } catch (err) {
    // P2003 = chave estrangeira (planta, item ou árvore que não existe no catálogo)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      throw new InvalidSaveError("Save com planta, item ou árvore desconhecidos");
    }
    throw err;
  }
}
