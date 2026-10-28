import type { Prisma } from "@prisma/client";
import { prisma } from "../../../shared/database/prisma";
import { GRID_SIZE } from "../utils/game.constants";

// Único lugar do módulo game que fala com o Prisma. As funções que recebem `db` funcionam dentro ou fora
// de uma transação; as que recebem `tx` só rodam dentro de uma (ver `transaction` e `lockSave`).

export type Tx = Prisma.TransactionClient;
export type Db = Tx | typeof prisma;
export type LockedSave = { id: string; money: number; farmerRow: number; farmerCol: number; farmerFreeAt: Date | null; farmerMovedAt: Date | null; barnCapacity: number; barnRow: number | null; barnCol: number | null;
  canCharges: number | null; wellRow: number | null; wellCol: number | null;
};
export type TilePos = { row: number; col: number };

// ---------- Transação ----------

// Conexão padrão, para leituras fora de uma transação
export const defaultDb: Db = prisma;

export const transaction = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction(fn);

// Trava a linha do save (FOR UPDATE): ações ao mesmo tempo (cliques rápidos, duas abas, dois aparelhos)
// entram em fila e cada uma vê o resultado da anterior.
export async function lockSave(tx: Tx, userId: string): Promise<LockedSave | null> {
  const [save] = await tx.$queryRaw<LockedSave[]>`SELECT id, money, farmer_row AS "farmerRow", farmer_col AS "farmerCol", farmer_free_at AS "farmerFreeAt", farmer_moved_at AS "farmerMovedAt", barn_capacity AS "barnCapacity", barn_row AS "barnRow", barn_col AS "barnCol", can_charges AS "canCharges", well_row AS "wellRow", well_col AS "wellCol" FROM saves WHERE user_id = ${userId}::uuid FOR UPDATE`;
  return save ?? null;
}

// ---------- Leitura do estado e do catálogo ----------

export const findSaveState = (db: Db, userId: string) =>
  db.save.findUnique({
    where: { userId },
    include: {
      plots: { include: { tiles: true }, orderBy: [{ y: "asc" }, { x: "asc" }] },
      inventory: true,
      treeHarvests: true,
      farmJobs: { orderBy: { seq: "asc" } },
      machines: { include: { jobs: { orderBy: { readyAt: "asc" } } } },
      animals: { orderBy: { createdAt: "asc" } },
    },
  });

export async function findCatalogData() {
  const [crops, items, trees, machines, animals] = await Promise.all([
    prisma.crop.findMany({ include: { seedItem: true, harvestItem: true }, orderBy: { seedItem: { sortOrder: "asc" } } }),
    prisma.item.findMany({ where: { kind: { not: "seed" } }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }),
    prisma.tree.findMany({ orderBy: { id: "asc" } }),
    prisma.machine.findMany({ include: { recipes: { include: { inputs: true }, orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } }),
    prisma.animal.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return { crops, items, trees, machines, animals };
}

// ---------- Terrenos e tiles ----------

export const findPlot = (tx: Tx, saveId: string, x: number, y: number) =>
  tx.plot.findUnique({ where: { saveId_x_y: { saveId, x, y } }, include: { tiles: { include: { crop: true } } } });

export const findPlotPositions = (tx: Tx, saveId: string) => tx.plot.findMany({ where: { saveId }, select: { x: true, y: true } });

// Células do mapa com terra arada ou plantação (não cabe prédio em cima)
export async function findUsedCells(tx: Tx, saveId: string): Promise<TilePos[]> {
  const plots = await tx.plot.findMany({ where: { saveId }, select: { x: true, y: true, tiles: { select: { row: true, col: true } } } });
  return plots.flatMap((p) => p.tiles.map((t) => ({ row: p.y * GRID_SIZE + t.row, col: p.x * GRID_SIZE + t.col })));
}

export const createPlot = (tx: Tx, saveId: string, x: number, y: number) => tx.plot.create({ data: { saveId, x, y } });

export const createTilledTiles = (tx: Tx, plotId: string, tiles: TilePos[]) =>
  tx.tile.createMany({ data: tiles.map((t) => ({ plotId, row: t.row, col: t.col, state: "tilled" as const })) });

// Desfaz a aragem: o tile deixa de existir (terra sem arar é a ausência de linha)
export const deleteTiles = (tx: Tx, plotId: string, tiles: TilePos[]) =>
  tx.tile.deleteMany({ where: { plotId, OR: tiles.map((t) => ({ row: t.row, col: t.col })) } });

// A planta começa a crescer agora (crescimento acumulado zerado)
export const plantTiles = (tx: Tx, plotId: string, tiles: TilePos[], cropId: string, plantedAt: Date) =>
  tx.tile.updateMany({
    where: { plotId, OR: tiles.map((t) => ({ row: t.row, col: t.col })) },
    data: { state: "planted", cropId, plantedAt, growth: 0, growthAt: plantedAt },
  });

// Volta os tiles para "arado" (depois da colheita); o adubo e a água foram usados pela planta
export const clearTiles = (tx: Tx, plotId: string, tiles: TilePos[]) =>
  tx.tile.updateMany({
    where: { plotId, OR: tiles.map((t) => ({ row: t.row, col: t.col })) },
    data: { state: "tilled", cropId: null, plantedAt: null, fertilized: false, watered: false, growth: 0, growthAt: null },
  });

// Aduba ou rega um tile; com planta, grava junto o crescimento acumulado até agora (utils/growth settleGrowth)
export const boostTile = (
  tx: Tx,
  plotId: string,
  tile: TilePos & { growth?: number; growthAt?: Date },
  boost: { fertilized: true } | { watered: true },
) =>
  tx.tile.update({
    where: { plotId_row_col: { plotId, row: tile.row, col: tile.col } },
    data: { ...boost, ...(tile.growthAt ? { growth: tile.growth, growthAt: tile.growthAt } : {}) },
  });

// ---------- Dinheiro e inventário ----------

export const changeMoney = (tx: Tx, saveId: string, amount: number) =>
  tx.save.update({ where: { id: saveId }, data: { money: { increment: amount } } });

export async function itemCount(tx: Tx, saveId: string, itemId: string) {
  const row = await tx.inventoryItem.findUnique({ where: { saveId_itemId: { saveId, itemId } } });
  return row?.quantity ?? 0;
}

export const addItem = (tx: Tx, saveId: string, itemId: string, quantity: number) =>
  tx.inventoryItem.upsert({
    where: { saveId_itemId: { saveId, itemId } },
    create: { saveId, itemId, quantity },
    update: { quantity: { increment: quantity } },
  });

// Tira do inventário; quem chama já conferiu que há o bastante. Zerou, a linha some (o banco não aceita 0).
export async function removeItem(tx: Tx, saveId: string, itemId: string, quantity: number, have: number) {
  const where = { saveId_itemId: { saveId, itemId } };
  if (have === quantity) await tx.inventoryItem.delete({ where });
  else await tx.inventoryItem.update({ where, data: { quantity: { decrement: quantity } } });
}

// ---------- Catálogo (consultas dentro da ação) ----------

export const findCrop = (tx: Tx, id: string) => tx.crop.findUnique({ where: { id } });
export const findMachine = (tx: Tx, id: string) => tx.machine.findUnique({ where: { id } });
export const findRecipe = (tx: Tx, id: string) => tx.recipe.findUnique({ where: { id }, include: { machine: true, inputs: { include: { item: true } } } });
export const findAnimal = (tx: Tx, id: string) => tx.animal.findUnique({ where: { id } });
export const findCropWithSeed = (tx: Tx, id: string) => tx.crop.findUnique({ where: { id }, include: { seedItem: true } });
export const findItem = (tx: Tx, id: string) => tx.item.findUnique({ where: { id } });
export const findTree = (tx: Tx, id: string) => tx.tree.findUnique({ where: { id } });


// ---------- Árvores ----------

export const findTreeHarvest = (tx: Tx, saveId: string, treeId: string) =>
  tx.treeHarvest.findUnique({ where: { saveId_treeId: { saveId, treeId } } });

export const saveTreeHarvest = (tx: Tx, saveId: string, treeId: string, harvestedAt: Date) =>
  tx.treeHarvest.upsert({
    where: { saveId_treeId: { saveId, treeId } },
    create: { saveId, treeId, harvestedAt },
    update: { harvestedAt },
  });

// ---------- Máquinas ----------

export const findSaveMachine = (tx: Tx, saveId: string, machineId: string) =>
  tx.saveMachine.findUnique({ where: { saveId_machineId: { saveId, machineId } } });

// Máquina construída na célula `at` (a de cima do chão dela)
export const createSaveMachine = (tx: Tx, saveId: string, machineId: string, at: TilePos) =>
  tx.saveMachine.create({ data: { saveId, machineId, row: at.row, col: at.col } });

// Máquinas do jogador, onde estão e o tamanho de cada uma
export const findOwnedMachines = (tx: Tx, saveId: string) =>
  tx.saveMachine.findMany({ where: { saveId }, include: { machine: { select: { size: true } } } });

export const moveSaveMachine = (tx: Tx, saveId: string, machineId: string, row: number, col: number) =>
  tx.saveMachine.update({ where: { saveId_machineId: { saveId, machineId } }, data: { row, col } });

// Fila da máquina, na ordem em que fica pronta (com a receita, para saber o que sai)
export const findMachineJobs = (tx: Tx, saveId: string, machineId: string) =>
  tx.machineJob.findMany({ where: { saveId, machineId }, include: { recipe: true }, orderBy: { readyAt: "asc" } });

export const createMachineJob = (tx: Tx, job: { saveId: string; machineId: string; recipeId: string; startsAt: Date; readyAt: Date }) =>
  tx.machineJob.create({ data: job });

export const deleteMachineJobs = (tx: Tx, ids: string[]) => tx.machineJob.deleteMany({ where: { id: { in: ids } } });

// ---------- Celeiro ----------

export const setBarnCapacity = (tx: Tx, saveId: string, capacity: number) =>
  tx.save.update({ where: { id: saveId }, data: { barnCapacity: capacity } });

// Constrói o celeiro (baias e lugar juntos: o banco exige os dois)
export const buildBarn = (tx: Tx, saveId: string, capacity: number, at: TilePos) =>
  tx.save.update({ where: { id: saveId }, data: { barnCapacity: capacity, barnRow: at.row, barnCol: at.col } });

export const setBarnPosition = (tx: Tx, saveId: string, row: number, col: number) =>
  tx.save.update({ where: { id: saveId }, data: { barnRow: row, barnCol: col } });

// ---------- Regador e poço ----------

export const setCanCharges = (tx: Tx, saveId: string, charges: number) => tx.save.update({ where: { id: saveId }, data: { canCharges: charges } });

export const setWellPosition = (tx: Tx, saveId: string, at: TilePos) =>
  tx.save.update({ where: { id: saveId }, data: { wellRow: at.row, wellCol: at.col } });

// Animais do jogador, do mais antigo para o mais novo (é a ordem em que comem quando falta ração)
export const findSaveAnimals = (tx: Tx, saveId: string) =>
  tx.saveAnimal.findMany({ where: { saveId }, include: { animal: true }, orderBy: { createdAt: "asc" } });

export const createSaveAnimal = (tx: Tx, saveId: string, animalId: string, createdAt: Date) =>
  tx.saveAnimal.create({ data: { saveId, animalId, createdAt } });

// fedAt = agora (comeram e começam a produzir) ou null (ficam com fome)
export const setAnimalsFed = (tx: Tx, ids: string[], fedAt: Date | null) =>
  tx.saveAnimal.updateMany({ where: { id: { in: ids } }, data: { fedAt } });

// ---------- Fila do fazendeiro ----------

export type FarmJobRow = NonNullable<Awaited<ReturnType<typeof findJobs>>>[number];
export type NewFarmJob = Omit<FarmJobRow, "id" | "seq" | "saveId" | "createdAt">;

export const findJobs = (tx: Tx, saveId: string) => tx.farmJob.findMany({ where: { saveId }, orderBy: { seq: "asc" } });

export const createJobs = (tx: Tx, saveId: string, jobs: NewFarmJob[]) =>
  tx.farmJob.createMany({ data: jobs.map((j) => ({ ...j, saveId })) });

export const deleteJobs = (tx: Tx, saveId: string, ids?: string[]) =>
  tx.farmJob.deleteMany({ where: { saveId, ...(ids ? { id: { in: ids } } : {}) } });

export const setFarmer = (tx: Tx, saveId: string, farmer: { row: number; col: number; freeAt: Date | null }) =>
  tx.save.update({ where: { id: saveId }, data: { farmerRow: farmer.row, farmerCol: farmer.col, farmerFreeAt: farmer.freeAt, farmerMovedAt: null } }); // a fila manda: acaba o andar livre

// Andar livre: guarda a posição que o cliente avisou e quando (o próximo aviso é conferido contra este horário).
// movedAt nulo = não está andando livre.
export const setFarmerWalk = (tx: Tx, saveId: string, walk: { row: number; col: number; movedAt: Date | null }) =>
  tx.save.update({ where: { id: saveId }, data: { farmerRow: walk.row, farmerCol: walk.col, farmerFreeAt: null, farmerMovedAt: walk.movedAt } });

// Pedidos de coleta pendentes num prédio (o fazendeiro está indo até ele)
// Pedidos pendentes em que o fazendeiro vai até o prédio (coletar, ou encher o regador no poço)
export const countBuildingJobs = (tx: Tx, saveId: string, building: { machineId: string } | "barn" | "well") =>
  tx.farmJob.count({
    where:
      building === "barn" ? { saveId, action: "collect_barn" }
      : building === "well" ? { saveId, action: "refill_can" }
      : { saveId, action: "collect_machine", machineId: building.machineId },
  });

// Jogadores com pedidos na fila: é por eles que o worker passa a cada rodada
export async function userIdsWithJobs(): Promise<string[]> {
  const rows = await prisma.farmJob.findMany({ distinct: ["saveId"], select: { save: { select: { userId: true } } } });
  return rows.map((r) => r.save.userId);
}
