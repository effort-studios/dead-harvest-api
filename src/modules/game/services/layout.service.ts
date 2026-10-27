import { UnprocessableError } from "../../../shared/errors/AppError";
import * as repo from "../repositories/game.repository";
import { BARN_FOOTPRINT, footprint, machineFootprint, placementProblem, WELL_FOOTPRINT, type Area, type Cell, type PlacementProblem } from "../utils/layout";

// Onde estão os prédios de um jogador e se um prédio cabe num lugar (regras em utils/layout)

export type BuildingRef = { kind: "machine"; machineId: string } | { kind: "barn" } | { kind: "well" };

// Chão dos prédios do jogador, menos `except` (o que está mudando de lugar)
export async function buildingAreas(tx: repo.Tx, save: repo.LockedSave, except?: BuildingRef): Promise<Area[]> {
  const areas: Area[] = [];
  for (const m of await repo.findOwnedMachines(tx, save.id)) {
    if (except?.kind === "machine" && except.machineId === m.machineId) continue;
    areas.push(footprint(machineFootprint(m.machine.size), m));
  }
  if (save.barnRow !== null && save.barnCol !== null && except?.kind !== "barn") {
    areas.push(footprint(BARN_FOOTPRINT, { row: save.barnRow, col: save.barnCol }));
  }
  if (save.wellRow !== null && save.wellCol !== null && except?.kind !== "well") {
    areas.push(footprint(WELL_FOOTPRINT, { row: save.wellRow, col: save.wellCol }));
  }
  return areas;
}

const PLACEMENT_MESSAGES: Record<PlacementProblem, string> = {
  OUTSIDE_PLOTS: "Construa dentro dos seus terrenos",
  ON_TILLED: "Tem terra arada aí: o prédio precisa de chão livre",
  ON_BUILDING: "Tem outro prédio aí",
};

// Confere se o prédio (de chão `shape`) cabe em `at`; senão, 422 PLACE_BLOCKED com o motivo
export async function requirePlace(tx: repo.Tx, save: repo.LockedSave, ref: BuildingRef, shape: Area, at: Cell) {
  const problem = placementProblem(footprint(shape, at), {
    plots: await repo.findPlotPositions(tx, save.id),
    used: await repo.findUsedCells(tx, save.id),
    others: await buildingAreas(tx, save, ref),
  });
  if (problem) throw new UnprocessableError(PLACEMENT_MESSAGES[problem], "PLACE_BLOCKED");
}
