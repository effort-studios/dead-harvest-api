import { describe, expect, it } from "vitest";
import { toGameState, type SaveRow } from "../../../src/modules/game/entities/game-state";
import { barnExpandPrice, DAY_LENGTH_SECONDS, GRID_SIZE, plotPrice, WORLD_EPOCH_MS } from "../../../src/modules/game/utils/game.constants";
import { initialSave } from "../../../src/modules/game/utils/initial-save";

const T0 = WORLD_EPOCH_MS;

const save = (over: Partial<SaveRow> = {}): SaveRow => ({
  gameStartedAt: new Date(T0),
  money: 100,
  plots: [{ x: 0, y: 0, tiles: [] }],
  inventory: [],
  treeHarvests: [],
  farmerRow: 4,
  farmerCol: -1.5,
  farmerFreeAt: null,
  farmJobs: [],
  machines: [],
  barnCapacity: 0,
  barnRow: null,
  barnCol: null,
  canCharges: null,
  wellRow: null,
  wellCol: null,
  animals: [],
  ...over,
});

describe("toGameState", () => {
  it("dia e hora vêm do relógio do servidor", () => {
    expect(toGameState(save(), T0)).toMatchObject({ day: 1, time: 0, serverTime: T0 });
    expect(toGameState(save(), T0 + 90_000)).toMatchObject({ day: 1, time: 90 });
    expect(toGameState(save(), T0 + DAY_LENGTH_SECONDS * 1000)).toMatchObject({ day: 2, time: 0 });
    expect(toGameState(save(), T0 + (DAY_LENGTH_SECONDS * 3 + 5) * 1000)).toMatchObject({ day: 4, time: 5 });
  });

  it("o relógio é do mundo: saves criados em momentos diferentes mostram a mesma hora", () => {
    const now = T0 + 777_000;
    const a = toGameState(save({ gameStartedAt: new Date(T0) }), now);
    const b = toGameState(save({ gameStartedAt: new Date(T0 + 500_000) }), now);
    expect([b.day, b.time]).toEqual([a.day, a.time]);
  });

  it("relógio do servidor antes do início do jogo não fica negativo", () => {
    expect(toGameState(save(), T0 - 60_000)).toMatchObject({ day: 1, time: 0 });
  });

  it("terreno sem tiles é uma malha cheia de terra", () => {
    const [plot] = toGameState(save(), T0).plots;
    expect(plot.grid).toHaveLength(GRID_SIZE);
    expect(plot.grid.every((row) => row.length === GRID_SIZE && row.every((t) => t.state === "soil" && t.crop === null))).toBe(true);
  });

  it("tile arado e tile plantado (com o crescimento em segundos)", () => {
    const planted = new Date(T0 - 42_500);
    const state = toGameState(
      save({
        plots: [
          {
            x: 1,
            y: -1,
            tiles: [
              { row: 0, col: 0, state: "tilled", cropId: null, fertilized: false, watered: false, growth: 0, growthAt: null },
              { row: 2, col: 3, state: "planted", cropId: "corn", fertilized: false, watered: false, growth: 0, growthAt: planted },
            ],
          },
        ],
      }),
      T0,
    );
    expect(state.plots[0]).toMatchObject({ x: 1, y: -1 });
    expect(state.plots[0].grid[0][0]).toEqual({ state: "tilled", crop: null, growth: 0, fertilized: false, watered: false });
    expect(state.plots[0].grid[2][3]).toEqual({ state: "planted", crop: "corn", growth: 42, fertilized: false, watered: false });
    expect(state.plots[0].grid[5][5].state).toBe("soil");
  });

  it("tile adubado e regado: arado mostra os dois; plantado cresce mais rápido a partir do acumulado", () => {
    const planted = new Date(T0 - 30_000);
    const state = toGameState(
      save({
        plots: [
          {
            x: 0,
            y: 0,
            tiles: [
              { row: 0, col: 0, state: "tilled", cropId: null, fertilized: true, watered: true, growth: 0, growthAt: null },
              { row: 0, col: 1, state: "planted", cropId: "corn", fertilized: true, watered: false, growth: 0, growthAt: planted },
              { row: 0, col: 2, state: "planted", cropId: "corn", fertilized: true, watered: true, growth: 10, growthAt: planted },
            ],
          },
        ],
      }),
      T0,
    );
    expect(state.plots[0].grid[0][0]).toEqual({ state: "tilled", crop: null, growth: 0, fertilized: true, watered: true });
    expect(state.plots[0].grid[0][1]).toEqual({ state: "planted", crop: "corn", growth: 39, fertilized: true, watered: false }); // 30 s x 1,3
    expect(state.plots[0].grid[0][2]).toEqual({ state: "planted", crop: "corn", growth: 58, fertilized: true, watered: true }); // 10 + 30 s x 1,6
  });

  it("máquinas e celeiro: horários em ms", () => {
    const startsAt = new Date(T0 - 1000);
    const readyAt = new Date(T0 + 5000);
    const fedAt = new Date(T0 - 2000);
    const state = toGameState(
      save({
        machines: [
          { machineId: "mill", row: 4, col: -4, jobs: [{ id: "j1", recipeId: "cornmeal", startsAt, readyAt }] },
          { machineId: "juicer", row: 12, col: -6, jobs: [] },
        ],
        barnCapacity: 4,
        barnRow: 14,
        barnCol: -2,
        animals: [{ id: "a1", animalId: "chicken", fedAt }, { id: "a2", animalId: "cow", fedAt: null }],
      }),
      T0,
    );
    expect(state.machines).toEqual({
      mill: { row: 4, col: -4, jobs: [{ id: "j1", recipeId: "cornmeal", startsAt: startsAt.getTime(), readyAt: readyAt.getTime() }] },
      juicer: { row: 12, col: -6, jobs: [] },
    });
    expect(state.barn).toEqual({ row: 14, col: -2, capacity: 4, animals: [{ id: "a1", animalId: "chicken", fedAt: fedAt.getTime() }, { id: "a2", animalId: "cow", fedAt: null }] });
  });

  it("inventário e colheitas de árvore viram mapas por id", () => {
    const harvestedAt = new Date(T0 - 1000);
    const state = toGameState(
      save({ inventory: [{ itemId: "corn", quantity: 3 }, { itemId: "apple", quantity: 7 }], treeHarvests: [{ treeId: "t1", harvestedAt }] }),
      T0,
    );
    expect(state.inventory).toEqual({ corn: 3, apple: 7 });
    expect(state.trees).toEqual({ t1: harvestedAt.getTime() });
    expect(state.money).toBe(100);
  });
});

describe("regras de preço e save inicial", () => {
  it("ampliar o celeiro: 400 a primeira e +50% a cada uma", () => {
    expect(barnExpandPrice(4)).toBe(400);
    expect(barnExpandPrice(6)).toBe(600);
    expect(barnExpandPrice(8)).toBe(900);
  });

  it("terreno novo: preço base e +50% a cada terreno comprado", () => {
    expect(plotPrice(1)).toBe(1000);
    expect(plotPrice(2)).toBe(1500);
    expect(plotPrice(3)).toBe(2250);
  });

  it("jogo novo: um terreno em 0,0, sementes ", () => {
    const s = initialSave(T0);
    expect(s.plots).toEqual([{ x: 0, y: 0 }]);
    expect(s.inventory).toEqual(expect.arrayContaining([{ itemId: "corn", quantity: 3 }]));
    const state = toGameState({ ...s, money: 100, plots: s.plots.map((p) => ({ ...p, tiles: [] })), treeHarvests: [], farmerRow: 4, farmerCol: -1.5, farmerFreeAt: null, farmJobs: [], machines: [], barnCapacity: 0, barnRow: null, barnCol: null, canCharges: null, wellRow: null, wellCol: null, animals: [] }, T0);
    expect(state.time).toBe(0);
    expect(state.day).toBe(1);
  });
});

describe("toGameState: fazendeiro", () => {
  const job = (over = {}) => ({ id: "j1", action: "till" as const, plotX: 0, plotY: 0, row: 0, col: 0, treeId: null, machineId: null, targetRow: 4, targetCol: 3.5, ...over });

  it("sem fila: só a posição", () => {
    expect(toGameState(save(), T0).farmer).toEqual({ row: 4, col: -1.5, jobs: [] });
  });

  it("todos os pedidos têm horários, encadeados a partir de farmerFreeAt", () => {
    const { farmer } = toGameState(save({ farmerFreeAt: new Date(T0), farmJobs: [job(), job({ id: "j2" })] }), T0);
    const [first, second] = farmer.jobs;
    expect(first.startsAt).toBe(T0);
    expect(first.arriveAt).toBeGreaterThanOrEqual(T0);
    expect(first.endsAt).toBeGreaterThanOrEqual(first.arriveAt!);
    expect(second.startsAt).toBe(first.endsAt); // o 2º começa quando o 1º termina
  });
});
