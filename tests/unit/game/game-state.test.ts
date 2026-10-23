import { describe, expect, it } from "vitest";
import { toGameState, type SaveRow } from "../../../src/modules/game/entities/game-state";
import { DAY_LENGTH_SECONDS, GRID_SIZE, plotPrice } from "../../../src/modules/game/utils/game.constants";
import { initialSave } from "../../../src/modules/game/utils/initial-save";

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

const save = (over: Partial<SaveRow> = {}): SaveRow => ({
  gameStartedAt: new Date(T0),
  money: 100,
  plots: [{ x: 0, y: 0, tiles: [] }],
  inventory: [],
  treeHarvests: [],
  ...over,
});

describe("toGameState", () => {
  it("dia e hora vêm do relógio do servidor", () => {
    expect(toGameState(save(), T0)).toMatchObject({ day: 1, time: 0, serverTime: T0 });
    expect(toGameState(save(), T0 + 90_000)).toMatchObject({ day: 1, time: 90 });
    expect(toGameState(save(), T0 + DAY_LENGTH_SECONDS * 1000)).toMatchObject({ day: 2, time: 0 });
    expect(toGameState(save(), T0 + (DAY_LENGTH_SECONDS * 3 + 5) * 1000)).toMatchObject({ day: 4, time: 5 });
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
              { row: 0, col: 0, state: "tilled", cropId: null, plantedAt: null },
              { row: 2, col: 3, state: "planted", cropId: "corn", plantedAt: planted },
            ],
          },
        ],
      }),
      T0,
    );
    expect(state.plots[0]).toMatchObject({ x: 1, y: -1 });
    expect(state.plots[0].grid[0][0]).toEqual({ state: "tilled", crop: null, growth: 0 });
    expect(state.plots[0].grid[2][3]).toEqual({ state: "planted", crop: "corn", growth: 42 });
    expect(state.plots[0].grid[5][5].state).toBe("soil");
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
  it("terreno novo: preço base e +50% a cada terreno comprado", () => {
    expect(plotPrice(1)).toBe(1000);
    expect(plotPrice(2)).toBe(1500);
    expect(plotPrice(3)).toBe(2250);
  });

  it("jogo novo: um terreno em 0,0, sementes e relógio começando no início da manhã", () => {
    const s = initialSave(T0);
    expect(s.plots).toEqual([{ x: 0, y: 0 }]);
    expect(s.inventory).toEqual(expect.arrayContaining([{ itemId: "corn", quantity: 3 }]));
    const state = toGameState({ ...s, money: 100, plots: s.plots.map((p) => ({ ...p, tiles: [] })), treeHarvests: [] }, T0);
    expect(state.time).toBe(Math.round((DAY_LENGTH_SECONDS * 6) / 24)); // 6h da manhã
    expect(state.day).toBe(1);
  });
});
