import type { Prisma } from "@prisma/client";
import { prisma } from "../../../shared/database/prisma";
import { NotFoundError } from "../../../shared/errors/AppError";
import { DAY_LENGTH_SECONDS, GRID_SIZE } from "../game.constants";

// O servidor é a fonte da verdade: o cliente só recebe o estado resultante; o que ele mostra entre
// uma resposta e outra é só previsão.

export type Db = Prisma.TransactionClient | typeof prisma;

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

const emptyGrid = (): TileView[][] =>
  Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ state: "soil" as const, crop: null, growth: 0 })),
  );

const seconds = (ms: number) => Math.max(0, Math.floor(ms / 1000));

export async function loadState(db: Db, userId: string, now: number): Promise<GameState | null> {
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

export async function getState(userId: string): Promise<GameState> {
  const state = await loadState(prisma, userId, Date.now());
  if (!state) throw new NotFoundError("Save não encontrado", "SAVE_NOT_FOUND");
  return state;
}
