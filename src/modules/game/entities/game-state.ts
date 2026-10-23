import { DAY_LENGTH_SECONDS, GRID_SIZE } from "../utils/game.constants";

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

// Save como o banco devolve (só o que o estado precisa)
export type SaveRow = {
  gameStartedAt: Date;
  money: number;
  plots: { x: number; y: number; tiles: { row: number; col: number; state: string; cropId: string | null; plantedAt: Date | null }[] }[];
  inventory: { itemId: string; quantity: number }[];
  treeHarvests: { treeId: string; harvestedAt: Date }[];
};

const emptyGrid = (): TileView[][] =>
  Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ state: "soil" as const, crop: null, growth: 0 })),
  );

const seconds = (ms: number) => Math.max(0, Math.floor(ms / 1000));

// O servidor é a fonte da verdade: o cliente só recebe este estado; o que ele mostra entre uma resposta
// e outra é só previsão. Dia e hora do jogo vêm do relógio do servidor (`now`).
export function toGameState(save: SaveRow, now: number): GameState {
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
