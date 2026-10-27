import { BadRequestError, ConflictError, NotFoundError, UnprocessableError } from "../../../shared/errors/AppError";
import * as repo from "../repositories/game.repository";
import { BARN, barnExpandPrice, WATERING_CAN, WELL } from "../utils/game.constants";
import { BARN_FOOTPRINT, machineFootprint, WELL_FOOTPRINT, type Area, type Cell } from "../utils/layout";
import { requirePlace, type BuildingRef } from "./layout.service";
import { act, type Action } from "./game-actions.service";

// Máquinas e celeiro: comprar, pôr receitas na fila, alimentar animais e coletar. Mesma convenção de erros de
// game-actions.service. Tudo é tempo real por timestamp (machine_jobs.ready_at, save_animals.fed_at), então a
// produção anda com o jogo fechado. Coletar é tarefa do fazendeiro (ele vai até lá): `xxxAction`, rodada pela fila.
// O jogador escolhe onde construir cada prédio (e arrasta depois: moveBuilding); as regras de lugar estão em
// utils/layout.

// ---------- Máquinas ----------

// Constrói a máquina na célula escolhida (a de cima do chão dela)
export const buyMachine = (userId: string, input: { machineId: string } & Cell) =>
  act(userId, async (tx, save) => {
    const machine = await repo.findMachine(tx, input.machineId);
    if (!machine) throw new BadRequestError("Máquina desconhecida", "UNKNOWN_MACHINE");
    if (await repo.findSaveMachine(tx, save.id, machine.id)) throw new ConflictError(`Você já tem ${machine.name.toLowerCase()}`, "MACHINE_ALREADY_OWNED");
    if (save.money < machine.buyPrice) throw new UnprocessableError("Dinheiro insuficiente", "INSUFFICIENT_FUNDS");
    const at = { row: input.row, col: input.col };
    await requirePlace(tx, save, { kind: "machine", machineId: machine.id }, machineFootprint(machine.size), at);
    await repo.createSaveMachine(tx, save.id, machine.id, at);
    await repo.changeMoney(tx, save.id, -machine.buyPrice);
  });

// Põe uma receita na fila da máquina: os ingredientes saem do armazém na hora. A receita começa quando a
// anterior fica pronta (ou agora, se a máquina está parada). Receita pronta e não coletada ocupa lugar na fila.
export const startRecipe = (userId: string, input: { recipeId: string }) =>
  act(userId, async (tx, save, now) => {
    const recipe = await repo.findRecipe(tx, input.recipeId);
    if (!recipe) throw new BadRequestError("Receita desconhecida", "UNKNOWN_RECIPE");
    const { machine } = recipe;
    if (!(await repo.findSaveMachine(tx, save.id, machine.id))) {
      throw new UnprocessableError(`Compre ${machine.name.toLowerCase()} antes`, "MACHINE_NOT_OWNED");
    }
    const jobs = await repo.findMachineJobs(tx, save.id, machine.id);
    if (jobs.length >= machine.queueSize) {
      throw new UnprocessableError(`A fila de ${machine.name.toLowerCase()} está cheia: colete o que ficou pronto`, "MACHINE_QUEUE_FULL");
    }

    const have = new Map<string, number>();
    for (const input of recipe.inputs) have.set(input.itemId, await repo.itemCount(tx, save.id, input.itemId));
    const missing = recipe.inputs.filter((i) => have.get(i.itemId)! < i.quantity);
    if (missing.length > 0) {
      const list = missing.map((i) => `${i.quantity - have.get(i.itemId)!} ${i.item.name.toLowerCase()}`).join(", ");
      throw new UnprocessableError(`Faltam ingredientes: ${list}`, "NOT_ENOUGH_ITEMS");
    }
    for (const i of recipe.inputs) await repo.removeItem(tx, save.id, i.itemId, i.quantity, have.get(i.itemId)!);

    const last = jobs[jobs.length - 1];
    const startsAt = Math.max(now, last?.readyAt.getTime() ?? now);
    await repo.createMachineJob(tx, {
      saveId: save.id,
      machineId: machine.id,
      recipeId: recipe.id,
      startsAt: new Date(startsAt),
      readyAt: new Date(startsAt + recipe.seconds * 1000),
    });
  });

// Coleta tudo o que já ficou pronto na máquina (o fazendeiro chega até ela)
export const collectMachineAction = (machineId: string): Action =>
  async (tx, save, now) => {
    if (!(await repo.findSaveMachine(tx, save.id, machineId))) throw new UnprocessableError("Você não tem essa máquina", "MACHINE_NOT_OWNED");
    const ready = (await repo.findMachineJobs(tx, save.id, machineId)).filter((j) => j.readyAt.getTime() <= now);
    if (ready.length === 0) throw new UnprocessableError("Ainda não tem nada pronto nessa máquina", "MACHINE_NOT_READY");
    for (const job of ready) await repo.addItem(tx, save.id, job.recipe.outputItemId, job.recipe.outputQuantity);
    await repo.deleteMachineJobs(tx, ready.map((j) => j.id));
  };

// ---------- Celeiro ----------

// Constrói o celeiro na célula escolhida (o meio dele)
export const buyBarn = (userId: string, input: Cell) =>
  act(userId, async (tx, save) => {
    if (save.barnCapacity > 0) throw new ConflictError("Você já tem o celeiro", "BARN_ALREADY_OWNED");
    if (save.money < BARN.price) throw new UnprocessableError("Dinheiro insuficiente", "INSUFFICIENT_FUNDS");
    const at = { row: input.row, col: input.col };
    await requirePlace(tx, save, { kind: "barn" }, BARN_FOOTPRINT, at);
    await repo.buildBarn(tx, save.id, BARN.startCapacity, at);
    await repo.changeMoney(tx, save.id, -BARN.price);
  });

// Mais baias; o preço sobe a cada ampliação
export const expandBarn = (userId: string) =>
  act(userId, async (tx, save) => {
    if (save.barnCapacity === 0) throw new UnprocessableError("Compre o celeiro antes", "NO_BARN");
    if (save.barnCapacity >= BARN.maxCapacity) throw new UnprocessableError("O celeiro já está no tamanho máximo", "BARN_MAX_SIZE");
    const price = barnExpandPrice(save.barnCapacity);
    if (save.money < price) throw new UnprocessableError("Dinheiro insuficiente", "INSUFFICIENT_FUNDS");
    await repo.setBarnCapacity(tx, save.id, Math.min(save.barnCapacity + BARN.expandBy, BARN.maxCapacity));
    await repo.changeMoney(tx, save.id, -price);
  });

// Animal novo chega com fome: é só alimentar (ração da Fábrica de ração)
export const buyAnimal = (userId: string, input: { animalId: string }) =>
  act(userId, async (tx, save, now) => {
    const animal = await repo.findAnimal(tx, input.animalId);
    if (!animal) throw new BadRequestError("Animal desconhecido", "UNKNOWN_ANIMAL");
    if (save.barnCapacity === 0) throw new UnprocessableError("Compre o celeiro antes", "NO_BARN");
    const owned = await repo.findSaveAnimals(tx, save.id);
    if (owned.length >= save.barnCapacity) throw new UnprocessableError("O celeiro está cheio: amplie para ter mais baias", "BARN_FULL");
    if (save.money < animal.buyPrice) throw new UnprocessableError("Dinheiro insuficiente", "INSUFFICIENT_FUNDS");
    await repo.createSaveAnimal(tx, save.id, animal.id, new Date(now));
    await repo.changeMoney(tx, save.id, -animal.buyPrice);
  });

type OwnedAnimal = Awaited<ReturnType<typeof repo.findSaveAnimals>>[number];

// Dá ração aos animais da lista, do mais antigo ao mais novo, enquanto houver; devolve os que comeram
async function feed(tx: repo.Tx, saveId: string, animals: OwnedAnimal[], now: number): Promise<OwnedAnimal[]> {
  const stock = new Map<string, number>();
  const fed: OwnedAnimal[] = [];
  for (const a of animals) {
    const { feedItemId, feedQuantity } = a.animal;
    if (!stock.has(feedItemId)) stock.set(feedItemId, await repo.itemCount(tx, saveId, feedItemId));
    if (stock.get(feedItemId)! < feedQuantity) continue;
    stock.set(feedItemId, stock.get(feedItemId)! - feedQuantity);
    fed.push(a);
  }
  if (fed.length === 0) return fed;
  for (const [itemId, left] of stock) {
    const used = fed.filter((a) => a.animal.feedItemId === itemId).reduce((sum, a) => sum + a.animal.feedQuantity, 0);
    if (used > 0) await repo.removeItem(tx, saveId, itemId, used, left + used);
  }
  await repo.setAnimalsFed(tx, fed.map((a) => a.id), new Date(now));
  return fed;
}

// Alimenta os animais com fome (os que já comeram estão produzindo e não comem de novo)
export const feedAnimals = (userId: string) =>
  act(userId, async (tx, save, now) => {
    const hungry = (await repo.findSaveAnimals(tx, save.id)).filter((a) => a.fedAt === null);
    if (hungry.length === 0) throw new UnprocessableError("Nenhum animal está com fome", "NO_HUNGRY_ANIMALS");
    const fed = await feed(tx, save.id, hungry, now);
    if (fed.length === 0) throw new UnprocessableError("Sem ração: faça na Fábrica de ração", "NO_FEED");
  });

// Coleta o que os animais produziram (o fazendeiro chega ao celeiro) e já dá ração de novo a eles, se houver;
// quem fica sem ração fica com fome
export const collectBarnAction = (): Action =>
  async (tx, save, now) => {
    if (save.barnCapacity === 0) throw new UnprocessableError("Compre o celeiro antes", "NO_BARN");
    const ready = (await repo.findSaveAnimals(tx, save.id)).filter(
      (a) => a.fedAt !== null && now - a.fedAt.getTime() >= a.animal.produceSeconds * 1000,
    );
    if (ready.length === 0) throw new UnprocessableError("Os animais ainda não produziram", "BARN_NOT_READY");

    // o produto de cada animal e o que ele soltou junto (esterco)
    const counts = new Map<string, number>();
    const give = (itemId: string, n: number) => counts.set(itemId, (counts.get(itemId) ?? 0) + n);
    for (const a of ready) {
      give(a.animal.productItemId, 1);
      if (a.animal.byproductItemId) give(a.animal.byproductItemId, a.animal.byproductQuantity);
    }
    for (const [itemId, n] of counts) await repo.addItem(tx, save.id, itemId, n);

    const fed = new Set((await feed(tx, save.id, ready, now)).map((a) => a.id));
    const hungry = ready.filter((a) => !fed.has(a.id)).map((a) => a.id);
    if (hungry.length > 0) await repo.setAnimalsFed(tx, hungry, null);
  };

// Para o fazendeiro saber se o pedido faz sentido antes de entrar na fila; devolve onde a máquina está e o
// tamanho dela
export async function requireOwnedMachine(tx: repo.Tx, saveId: string, machineId: string) {
  const machine = await repo.findMachine(tx, machineId);
  if (!machine) throw new NotFoundError("Máquina não encontrada", "MACHINE_NOT_FOUND");
  const owned = await repo.findSaveMachine(tx, saveId, machine.id);
  if (!owned) throw new UnprocessableError("Você não tem essa máquina", "MACHINE_NOT_OWNED");
  return { machineId: machine.id, size: machine.size, row: owned.row, col: owned.col };
}

// ---------- Poço ----------

// Constrói o poço na célula escolhida
export const buyWell = (userId: string, input: Cell) =>
  act(userId, async (tx, save) => {
    if (save.wellRow !== null) throw new ConflictError("Você já tem o poço", "WELL_ALREADY_OWNED");
    if (save.money < WELL.price) throw new UnprocessableError("Dinheiro insuficiente", "INSUFFICIENT_FUNDS");
    const at = { row: input.row, col: input.col };
    await requirePlace(tx, save, { kind: "well" }, WELL_FOOTPRINT, at);
    await repo.setWellPosition(tx, save.id, at);
    await repo.changeMoney(tx, save.id, -WELL.price);
  });

// Para o fazendeiro saber se o pedido faz sentido antes de entrar na fila
export function requireCanRefill(save: repo.LockedSave) {
  if (save.canCharges === null) throw new UnprocessableError("Compre o regador na loja antes", "NO_CAN");
  if (save.wellRow === null || save.wellCol === null) throw new UnprocessableError("Construa um poço para encher o regador", "NO_WELL");
  return { row: save.wellRow, col: save.wellCol };
}

// Enche o regador (o fazendeiro chega ao poço)
export const refillCanAction = (): Action =>
  async (tx, save) => {
    requireCanRefill(save);
    if (save.canCharges === WATERING_CAN.charges) throw new ConflictError("O regador já está cheio", "CAN_FULL");
    await repo.setCanCharges(tx, save.id, WATERING_CAN.charges);
  };

// ---------- Lugar dos prédios ----------

// Muda um prédio construído de lugar (o jogador arrastou no mapa). Não muda enquanto o fazendeiro está indo
// coletar nele, para ele não ir até o lugar velho.
export const moveBuilding = (userId: string, input: BuildingRef & { row: number; col: number }) =>
  act(userId, async (tx, save) => {
    const ref: BuildingRef = input.kind === "machine" ? { kind: "machine", machineId: input.machineId } : { kind: input.kind };
    let shape: Area;
    if (ref.kind === "barn") {
      if (save.barnCapacity === 0) throw new UnprocessableError("Compre o celeiro antes", "NO_BARN");
      shape = BARN_FOOTPRINT;
    } else if (ref.kind === "well") {
      if (save.wellRow === null) throw new UnprocessableError("Construa o poço antes", "NO_WELL");
      shape = WELL_FOOTPRINT;
    } else {
      shape = machineFootprint((await requireOwnedMachine(tx, save.id, ref.machineId)).size);
    }
    if ((await repo.countBuildingJobs(tx, save.id, ref.kind === "machine" ? { machineId: ref.machineId } : ref.kind)) > 0) {
      throw new UnprocessableError("O fazendeiro está indo até aí: espere ele terminar", "BUILDING_BUSY");
    }
    const at = { row: input.row, col: input.col };
    await requirePlace(tx, save, ref, shape, at);

    if (ref.kind === "barn") await repo.setBarnPosition(tx, save.id, at.row, at.col);
    else if (ref.kind === "well") await repo.setWellPosition(tx, save.id, at);
    else await repo.moveSaveMachine(tx, save.id, ref.machineId, at.row, at.col);
  });
