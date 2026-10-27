import { schedule } from "../utils/farmer-timeline";
import { DAY_LENGTH_SECONDS, GRID_SIZE } from "../utils/game.constants";
import { growthSeconds } from "../utils/growth";

// growth: segundos de crescimento (já contando adubo e água); fertilized/watered: tile adubado/regado
export type TileView = { state: "soil" | "tilled" | "planted"; crop: string | null; growth: number; fertilized: boolean; watered: boolean };

// Máquina comprada: onde o jogador deixou e a fila, cada receita com os horários (ms, relógio do servidor) em que
// começa e fica pronta
export type MachineView = { row: number; col: number; jobs: { id: string; recipeId: string; startsAt: number; readyAt: number }[] };
// Celeiro: onde está (nulo = não comprou), baias (0 = não comprou) e os animais; fedAt = ms em que comeu
// (null = com fome, parado)
export type BarnView = { row: number | null; col: number | null; capacity: number; animals: { id: string; animalId: string; fedAt: number | null }[] };

export type GameState = {
  serverTime: number; // ms; o cliente usa para acertar o relógio dele (frutas, crescimento)
  day: number;
  time: number; // segundos desde o início do dia
  money: number;
  plots: { x: number; y: number; grid: TileView[][] }[];
  inventory: Record<string, number>;
  trees: Record<string, number>; // id da árvore -> ms da última colheita
  machines: Record<string, MachineView>; // só as máquinas compradas, por id
  barn: BarnView;
  canCharges: number | null; // cargas do regador; null = não comprou
  well: { row: number; col: number } | null; // onde está o poço; null = não construiu
  farmer: FarmerView;
};

// O fazendeiro e a fila dele. (row, col) é onde ele está parado ANTES de começar jobs[0]; o cliente anima a
// partir dos horários (ms, relógio do servidor) de cada pedido: um começa quando o anterior termina.
export type JobView = {
  id: string;
  action: "till" | "untill" | "plant" | "harvest" | "harvest_tree" | "fertilize" | "water" | "collect_machine" | "collect_barn" | "refill_can" | "move";
  plotX: number | null;
  plotY: number | null;
  row: number | null;
  col: number | null;
  treeId: string | null;
  machineId: string | null;
  targetRow: number; // célula do mapa onde ele precisa estar
  targetCol: number;
  startsAt: number; // horários do pedido: começa a andar, chega e termina o gesto
  arriveAt: number;
  endsAt: number;
};
export type FarmerView = { row: number; col: number; jobs: JobView[] };

// Save como o banco devolve (só o que o estado precisa)
export type SaveRow = {
  gameStartedAt: Date;
  money: number;
  plots: { x: number; y: number; tiles: { row: number; col: number; state: string; cropId: string | null; fertilized: boolean; watered: boolean; growth: number; growthAt: Date | null }[] }[];
  inventory: { itemId: string; quantity: number }[];
  treeHarvests: { treeId: string; harvestedAt: Date }[];
  machines: { machineId: string; row: number; col: number; jobs: { id: string; recipeId: string; startsAt: Date; readyAt: Date }[] }[];
  barnCapacity: number;
  barnRow: number | null;
  barnCol: number | null;
  canCharges: number | null;
  wellRow: number | null;
  wellCol: number | null;
  animals: { id: string; animalId: string; fedAt: Date | null }[];
  farmerRow: number;
  farmerCol: number;
  farmerFreeAt: Date | null;
  farmJobs: (Omit<JobView, "startsAt" | "arriveAt" | "endsAt"> & { seq?: number })[];
};

const emptyGrid = (): TileView[][] =>
  Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ state: "soil" as const, crop: null, growth: 0, fertilized: false, watered: false })),
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
          t.state === "planted"
            ? { state: "planted", crop: t.cropId, growth: Math.floor(growthSeconds(t, now)), fertilized: t.fertilized, watered: t.watered }
            : { state: "tilled", crop: null, growth: 0, fertilized: t.fertilized, watered: t.watered };
      }
      return { x: plot.x, y: plot.y, grid };
    }),
    inventory: Object.fromEntries(save.inventory.map((i) => [i.itemId, i.quantity])),
    trees: Object.fromEntries(save.treeHarvests.map((h) => [h.treeId, h.harvestedAt.getTime()])),
    machines: Object.fromEntries(
      save.machines.map((m) => [
        m.machineId,
        { row: m.row, col: m.col, jobs: m.jobs.map((j) => ({ id: j.id, recipeId: j.recipeId, startsAt: j.startsAt.getTime(), readyAt: j.readyAt.getTime() })) },
      ]),
    ),
    barn: {
      row: save.barnRow,
      col: save.barnCol,
      capacity: save.barnCapacity,
      animals: save.animals.map((a) => ({ id: a.id, animalId: a.animalId, fedAt: a.fedAt?.getTime() ?? null })),
    },
    canCharges: save.canCharges,
    well: save.wellRow !== null && save.wellCol !== null ? { row: save.wellRow, col: save.wellCol } : null,
    farmer: toFarmerView(save, now),
  };
}

function toFarmerView(save: SaveRow, now: number): FarmerView {
  const at = { row: save.farmerRow, col: save.farmerCol };
  // a fila inteira ganha horários, encadeados (cada pedido começa quando o anterior termina): a tela anima o
  // trajeto todo sem esperar o servidor responder entre um tile e outro
  let from = at;
  let startsAt = save.farmerFreeAt?.getTime() ?? now;
  const jobs: JobView[] = save.farmJobs.map(({ seq: _seq, ...job }) => {
    const to = { row: job.targetRow, col: job.targetCol };
    const s = schedule(from, to, startsAt);
    from = to;
    startsAt = s.endsAt;
    return { ...job, ...s };
  });
  return { ...at, jobs };
}
