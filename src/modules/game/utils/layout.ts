import { GRID_SIZE } from "./game.constants";

// Onde os prédios podem ficar. O jogador constrói máquinas e celeiro nos terrenos dele (e arrasta depois); cada
// prédio ocupa um retângulo de células (o "chão" dele) e esse chão tem que cair inteiro dentro dos terrenos
// comprados (pode passar de um terreno para o vizinho), sem terra arada ou plantação e sem outro prédio. Embaixo
// de um prédio não se ara. Mesmas contas no cliente (o catálogo manda BARN_FOOTPRINT e o tamanho de cada
// máquina).

export type Cell = { row: number; col: number };
export type Area = { r0: number; r1: number; c0: number; c1: number }; // células de r0 a r1 e de c0 a c1 (inclusive)

// Chão em relação à célula do prédio. A máquina de tamanho `size` ocupa size x size células a partir da dela
// (a de cima na tela). O celeiro: ele (3x3 em volta da célula dele), o cercadinho dos animais à direita e a
// frente da porta, onde o fazendeiro para.
export const machineFootprint = (size: number): Area => ({ r0: 0, r1: size - 1, c0: 0, c1: size - 1 });
export const BARN_FOOTPRINT: Area = { r0: -1, r1: 2, c0: -1, c1: 5 };
// O poço ocupa só a célula dele
export const WELL_FOOTPRINT: Area = { r0: 0, r1: 0, c0: 0, c1: 0 };

export const footprint = (shape: Area, at: Cell): Area => ({ r0: at.row + shape.r0, r1: at.row + shape.r1, c0: at.col + shape.c0, c1: at.col + shape.c1 });

export const overlaps = (a: Area, b: Area) => a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;

// Células do chão (r, c), uma a uma
export function cellsOf(a: Area): Cell[] {
  const cells: Cell[] = [];
  for (let row = a.r0; row <= a.r1; row++) for (let col = a.c0; col <= a.c1; col++) cells.push({ row, col });
  return cells;
}

const inPlot = (cell: Cell, p: { x: number; y: number }) =>
  cell.row >= p.y * GRID_SIZE && cell.row < (p.y + 1) * GRID_SIZE && cell.col >= p.x * GRID_SIZE && cell.col < (p.x + 1) * GRID_SIZE;

export type PlacementProblem = "OUTSIDE_PLOTS" | "ON_TILLED" | "ON_BUILDING";

// O que impede o prédio de ficar ali (null = pode). `used` são as células (do mapa) com terra arada ou
// plantação; `others`, os chãos dos outros prédios do jogador.
export function placementProblem(
  area: Area,
  world: { plots: { x: number; y: number }[]; used: Cell[]; others: Area[] },
): PlacementProblem | null {
  if (!cellsOf(area).every((cell) => world.plots.some((p) => inPlot(cell, p)))) return "OUTSIDE_PLOTS";
  if (world.used.some((u) => overlaps(area, { r0: u.row, r1: u.row, c0: u.col, c1: u.col }))) return "ON_TILLED";
  if (world.others.some((o) => overlaps(area, o))) return "ON_BUILDING";
  return null;
}

// Onde o fazendeiro para para coletar: na frente da máquina (a célula na diagonal do canto da frente, como na
// árvore) e na frente da porta do celeiro
export const machineCollectTarget = (at: Cell, size: number): Cell => ({ row: at.row + size, col: at.col + size });
export const barnCollectTarget = (at: Cell): Cell => ({ row: at.row + 2, col: at.col });
// No poço, como numa máquina de 1 célula
export const wellTarget = (at: Cell): Cell => machineCollectTarget(at, 1);
