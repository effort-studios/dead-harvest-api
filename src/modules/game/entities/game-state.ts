import { schedule } from "../utils/farmer-timeline";
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
  farmer: FarmerView;
};

// O fazendeiro e a fila dele. (row, col) é onde ele está parado ANTES de começar jobs[0]; o cliente anima a
// partir dos horários (ms, relógio do servidor) do primeiro pedido, que é o único que tem `startsAt`.
export type JobView = {
  id: string;
  action: "till" | "plant" | "harvest" | "harvest_tree";
  plotX: number | null;
  plotY: number | null;
  row: number | null;
  col: number | null;
  treeId: string | null;
  targetRow: number; // célula do mapa onde ele precisa estar
  targetCol: number;
  startsAt?: number; // horários do pedido em andamento: começa a andar, chega e termina o gesto
  arriveAt?: number;
  endsAt?: number;
};
export type FarmerView = { row: number; col: number; jobs: JobView[] };

// Save como o banco devolve (só o que o estado precisa)
export type SaveRow = {
  gameStartedAt: Date;
  money: number;
  plots: { x: number; y: number; tiles: { row: number; col: number; state: string; cropId: string | null; plantedAt: Date | null }[] }[];
  inventory: { itemId: string; quantity: number }[];
  treeHarvests: { treeId: string; harvestedAt: Date }[];
  farmerRow: number;
  farmerCol: number;
  farmerFreeAt: Date | null;
  farmJobs: (Omit<JobView, "startsAt" | "arriveAt" | "endsAt"> & { seq?: number })[];
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
    farmer: toFarmerView(save, now),
  };
}

function toFarmerView(save: SaveRow, now: number): FarmerView {
  const at = { row: save.farmerRow, col: save.farmerCol };
  const jobs: JobView[] = save.farmJobs.map(({ seq: _seq, ...job }) => job);
  const head = jobs[0];
  if (head) {
    const s = schedule(at, { row: head.targetRow, col: head.targetCol }, save.farmerFreeAt?.getTime() ?? now);
    Object.assign(head, s);
  }
  return { ...at, jobs };
}
