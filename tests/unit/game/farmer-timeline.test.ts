import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../../../src/config";
import { clampWalk } from "../../../src/modules/game/utils/farmer-timeline";

const originalSpeed = config.farmerWalkSpeed;
beforeEach(() => {
  config.farmerWalkSpeed = 2;
});
afterEach(() => {
  config.farmerWalkSpeed = originalSpeed;
});

describe("clampWalk", () => {
  const from = { row: 0, col: 0 };

  it("aceita o que dá tempo de andar (com a folga)", () => {
    expect(clampWalk(from, { row: 2, col: 0 }, 1000)).toEqual({ row: 2, col: 0 }); // 2 células/s, 1s
  });

  it("corta em linha reta no ponto mais longe que alcançaria", () => {
    const to = clampWalk(from, { row: 100, col: 0 }, 1000);
    expect(to.col).toBe(0);
    expect(to.row).toBeCloseTo(2 * 1.25 + 0.5); // 2 células/s x 1s x tolerância + folga
  });

  it("limita o crédito de tempo parado", () => {
    expect(clampWalk(from, { row: 100, col: 0 }, 10 * 60 * 1000).row).toBeCloseTo(2 * 3 * 1.25 + 0.5);
  });

  it("tempo negativo (relógio voltou) conta como zero, só com a folga fixa", () => {
    expect(clampWalk(from, { row: 100, col: 0 }, -5000).row).toBeCloseTo(0.5);
  });
});
