import { describe, expect, it } from "vitest";
import { BARN_FOOTPRINT, barnCollectTarget, footprint, machineCollectTarget, machineFootprint, placementProblem } from "../../../src/modules/game/utils/layout";

const world = (over: Partial<Parameters<typeof placementProblem>[1]> = {}) => ({ plots: [{ x: 0, y: 0 }], used: [], others: [], ...over });
const machineAt = (size: number, row: number, col: number) => footprint(machineFootprint(size), { row, col });

describe("lugar dos prédios", () => {
  it("só dentro dos terrenos do jogador, inteiro", () => {
    expect(placementProblem(machineAt(1, 5, 5), world())).toBeNull();
    expect(placementProblem(machineAt(1, 5, -1), world())).toBe("OUTSIDE_PLOTS");
    expect(placementProblem(machineAt(2, 9, 9), world())).toBe("OUTSIDE_PLOTS"); // a 2x2 sai pela borda
    expect(
      placementProblem(
        machineAt(2, 9, 9),
        world({
          plots: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("não em cima de terra arada ou plantação", () => {
    expect(placementProblem(machineAt(2, 4, 4), world({ used: [{ row: 5, col: 5 }] }))).toBe("ON_TILLED");
    expect(placementProblem(machineAt(2, 4, 4), world({ used: [{ row: 6, col: 6 }] }))).toBeNull();
  });

  it("a máquina ocupa size x size; o celeiro, ele, o cercadinho à direita e a frente da porta", () => {
    expect(machineAt(2, 4, 4)).toEqual({ r0: 4, r1: 5, c0: 4, c1: 5 });
    expect(footprint(BARN_FOOTPRINT, { row: 6, col: 2 })).toEqual({ r0: 5, r1: 8, c0: 1, c1: 7 });
    expect(placementProblem(footprint(BARN_FOOTPRINT, { row: 6, col: 2 }), world({ others: [machineAt(1, 6, 6)] }))).toBe("ON_BUILDING");
  });

  it("o fazendeiro para na frente da máquina (conforme o tamanho) e da porta do celeiro", () => {
    expect(machineCollectTarget({ row: 4, col: 4 }, 1)).toEqual({ row: 5, col: 5 });
    expect(machineCollectTarget({ row: 4, col: 4 }, 2)).toEqual({ row: 6, col: 6 });
    expect(barnCollectTarget({ row: 6, col: 2 })).toEqual({ row: 8, col: 2 });
  });
});
