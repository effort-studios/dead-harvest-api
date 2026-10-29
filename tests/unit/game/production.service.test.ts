import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestError, ConflictError, UnprocessableError } from "../../../src/shared/errors/AppError";

vi.mock("../../../src/modules/game/repositories/game.repository");

import * as gameRepository from "../../../src/modules/game/repositories/game.repository";
import * as production from "../../../src/modules/game/services/production.service";

const repo = vi.mocked(gameRepository);
const tx = { tx: true } as never;
const T0 = Date.UTC(2026, 0, 1);
const SAVE = {
  id: "save-1",
  money: 1000,
  farmerRow: 4,
  farmerCol: -1.5,
  farmerFreeAt: null,
  barnCapacity: 4,
  barnRow: 1 as number | null,
  barnCol: -7 as number | null,
};

function setup(save: Partial<typeof SAVE> = {}) {
  repo.transaction.mockImplementation(((fn: (t: never) => unknown) => fn(tx)) as never);
  repo.lockSave.mockResolvedValue({ ...SAVE, ...save } as never);
  // um terreno vazio em (0,0): cabe qualquer prédio dentro dele
  repo.findPlotPositions.mockResolvedValue([{ x: 0, y: 0 }]);
  repo.findUsedCells.mockResolvedValue([]);
  repo.findOwnedMachines.mockResolvedValue([]);
  repo.findSaveState.mockResolvedValue({
    gameStartedAt: new Date(T0),
    money: 0,
    plots: [],
    inventory: [],
    treeHarvests: [],
    farmerRow: 4,
    farmerCol: -1.5,
    farmerFreeAt: null,
    farmJobs: [],
    machines: [],
    barnCapacity: 0,
    animals: [],
  } as never);
}

// O que a action do fazendeiro recebe: o save já travado, a transação e o instante
const runAction = (action: ReturnType<typeof production.collectBarnAction>, save: Partial<typeof SAVE> = {}) => action(tx, { ...SAVE, ...save } as never, T0);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  setup();
});

const mill = { id: "mill", name: "Moinho", buyPrice: 300, size: 2, queueSize: 2, sortOrder: 1 };
const item = (id: string, name: string) => ({ id, name });
const cornmeal = {
  id: "cornmeal",
  machineId: "mill",
  machine: mill,
  outputItemId: "cornmeal",
  outputQuantity: 1,
  seconds: 60,
  inputs: [{ itemId: "corn_harvest", quantity: 3, item: item("corn_harvest", "Milho") }],
};

describe("buyMachine", () => {
  it("máquina que não existe: 400 UNKNOWN_MACHINE", async () => {
    repo.findMachine.mockResolvedValue(null);
    await expect(production.buyMachine("u1", { machineId: "x", row: 5, col: 5 })).rejects.toMatchObject({
      constructor: BadRequestError,
      code: "UNKNOWN_MACHINE",
    });
  });

  it("já tem: 409 MACHINE_ALREADY_OWNED", async () => {
    repo.findMachine.mockResolvedValue(mill as never);
    repo.findSaveMachine.mockResolvedValue({} as never);
    await expect(production.buyMachine("u1", { machineId: "mill", row: 5, col: 5 })).rejects.toMatchObject({
      constructor: ConflictError,
      code: "MACHINE_ALREADY_OWNED",
    });
  });

  it("sem dinheiro: 422 INSUFFICIENT_FUNDS", async () => {
    setup({ money: 299 });
    repo.findMachine.mockResolvedValue(mill as never);
    await expect(production.buyMachine("u1", { machineId: "mill", row: 5, col: 5 })).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(repo.createSaveMachine).not.toHaveBeenCalled();
  });

  it("constrói no lugar escolhido e paga", async () => {
    repo.findMachine.mockResolvedValue(mill as never);
    await production.buyMachine("u1", { machineId: "mill", row: 5, col: 5 });
    expect(repo.createSaveMachine).toHaveBeenCalledWith(tx, "save-1", "mill", { row: 5, col: 5 });
    expect(repo.changeMoney).toHaveBeenCalledWith(tx, "save-1", -300);
  });

  it("lugar ocupado pelo chão de outra máquina (o moinho ocupa 2x2): 422 PLACE_BLOCKED", async () => {
    repo.findMachine.mockResolvedValue(mill as never);
    repo.findOwnedMachines.mockResolvedValue([{ machineId: "dairy", row: 6, col: 6, machine: { size: 2 } }] as never);
    await expect(production.buyMachine("u1", { machineId: "mill", row: 5, col: 5 })).rejects.toMatchObject({ code: "PLACE_BLOCKED" });
    expect(repo.createSaveMachine).not.toHaveBeenCalled();
  });
});

describe("startRecipe", () => {
  beforeEach(() => {
    repo.findRecipe.mockResolvedValue(cornmeal as never);
    repo.findSaveMachine.mockResolvedValue({} as never);
    repo.findMachineJobs.mockResolvedValue([]);
  });

  it("receita que não existe: 400 UNKNOWN_RECIPE", async () => {
    repo.findRecipe.mockResolvedValue(null);
    await expect(production.startRecipe("u1", { recipeId: "x" })).rejects.toMatchObject({ constructor: BadRequestError, code: "UNKNOWN_RECIPE" });
  });

  it("sem a máquina: 422 MACHINE_NOT_OWNED", async () => {
    repo.findSaveMachine.mockResolvedValue(null);
    await expect(production.startRecipe("u1", { recipeId: "cornmeal" })).rejects.toMatchObject({ constructor: UnprocessableError, code: "MACHINE_NOT_OWNED" });
  });

  it("fila cheia (prontas não coletadas contam): 422 MACHINE_QUEUE_FULL", async () => {
    repo.findMachineJobs.mockResolvedValue([{ readyAt: new Date(T0 - 1) }, { readyAt: new Date(T0 + 1) }] as never);
    await expect(production.startRecipe("u1", { recipeId: "cornmeal" })).rejects.toMatchObject({ code: "MACHINE_QUEUE_FULL" });
  });

  it("faltam ingredientes: 422 NOT_ENOUGH_ITEMS dizendo quanto falta, sem gastar nada", async () => {
    repo.itemCount.mockResolvedValue(1);
    await expect(production.startRecipe("u1", { recipeId: "cornmeal" })).rejects.toMatchObject({
      code: "NOT_ENOUGH_ITEMS",
      message: "Faltam ingredientes: 2 milho",
    });
    expect(repo.removeItem).not.toHaveBeenCalled();
    expect(repo.createMachineJob).not.toHaveBeenCalled();
  });

  it("máquina parada: gasta os ingredientes e começa agora", async () => {
    repo.itemCount.mockResolvedValue(5);
    await production.startRecipe("u1", { recipeId: "cornmeal" });
    expect(repo.removeItem).toHaveBeenCalledWith(tx, "save-1", "corn_harvest", 3, 5);
    expect(repo.createMachineJob).toHaveBeenCalledWith(tx, {
      saveId: "save-1",
      machineId: "mill",
      recipeId: "cornmeal",
      startsAt: new Date(T0),
      readyAt: new Date(T0 + 60_000),
    });
  });

  it("máquina ocupada: começa quando a anterior fica pronta", async () => {
    repo.itemCount.mockResolvedValue(3);
    repo.findMachineJobs.mockResolvedValue([{ readyAt: new Date(T0 + 20_000) }] as never);
    await production.startRecipe("u1", { recipeId: "cornmeal" });
    expect(repo.createMachineJob).toHaveBeenCalledWith(tx, expect.objectContaining({ startsAt: new Date(T0 + 20_000), readyAt: new Date(T0 + 80_000) }));
  });
});

describe("collectMachineAction", () => {
  it("nada pronto: 422 MACHINE_NOT_READY", async () => {
    repo.findSaveMachine.mockResolvedValue({} as never);
    repo.findMachineJobs.mockResolvedValue([{ id: "j1", readyAt: new Date(T0 + 1), recipe: cornmeal }] as never);
    await expect(runAction(production.collectMachineAction("mill"))).rejects.toMatchObject({ code: "MACHINE_NOT_READY" });
  });

  it("coleta só o que já ficou pronto", async () => {
    repo.findSaveMachine.mockResolvedValue({} as never);
    repo.findMachineJobs.mockResolvedValue([
      { id: "j1", readyAt: new Date(T0), recipe: cornmeal },
      { id: "j2", readyAt: new Date(T0 + 1), recipe: cornmeal },
    ] as never);
    await runAction(production.collectMachineAction("mill"));
    expect(repo.addItem).toHaveBeenCalledWith(tx, "save-1", "cornmeal", 1);
    expect(repo.deleteMachineJobs).toHaveBeenCalledWith(tx, ["j1"]);
  });
});

describe("celeiro", () => {
  const chicken = {
    id: "chicken",
    name: "Galinha",
    buyPrice: 150,
    feedItemId: "feed",
    feedQuantity: 1,
    productItemId: "egg",
    produceSeconds: 60,
    byproductItemId: "manure" as string | null,
    byproductQuantity: 1,
  };
  const cow = { ...chicken, id: "cow", name: "Vaca", feedQuantity: 2, productItemId: "milk", produceSeconds: 120, byproductQuantity: 2 };
  const sheep = { ...chicken, id: "sheep", name: "Ovelha", productItemId: "wool", byproductItemId: null, byproductQuantity: 0 };
  const owned = (id: string, animal: typeof chicken, fedAt: Date | null) => ({ id, animalId: animal.id, animal, fedAt });

  it("comprar o celeiro: 409 se já tem; senão 4 baias por 500", async () => {
    await expect(production.buyBarn("u1", { row: 2, col: 2 })).rejects.toMatchObject({ constructor: ConflictError, code: "BARN_ALREADY_OWNED" });
    setup({ barnCapacity: 0, barnRow: null, barnCol: null });
    await production.buyBarn("u1", { row: 2, col: 2 });
    expect(repo.buildBarn).toHaveBeenCalledWith(tx, "save-1", 4, { row: 2, col: 2 });
    expect(repo.changeMoney).toHaveBeenCalledWith(tx, "save-1", -500);
  });

  it("ampliar: sem celeiro 422 NO_BARN; no máximo 422 BARN_MAX_SIZE; senão +2 baias", async () => {
    setup({ barnCapacity: 0 });
    await expect(production.expandBarn("u1")).rejects.toMatchObject({ code: "NO_BARN" });
    setup({ barnCapacity: 12 });
    await expect(production.expandBarn("u1")).rejects.toMatchObject({ code: "BARN_MAX_SIZE" });
    setup({ barnCapacity: 6 });
    await production.expandBarn("u1");
    expect(repo.setBarnCapacity).toHaveBeenCalledWith(tx, "save-1", 8);
    expect(repo.changeMoney).toHaveBeenCalledWith(tx, "save-1", -600);
  });

  it("comprar animal: precisa de celeiro e de baia livre", async () => {
    repo.findAnimal.mockResolvedValue(chicken as never);
    setup({ barnCapacity: 0 });
    await expect(production.buyAnimal("u1", { animalId: "chicken" })).rejects.toMatchObject({ code: "NO_BARN" });
    setup({ barnCapacity: 1 });
    repo.findSaveAnimals.mockResolvedValue([owned("a1", chicken, null)] as never);
    await expect(production.buyAnimal("u1", { animalId: "chicken" })).rejects.toMatchObject({ code: "BARN_FULL" });
    setup({ barnCapacity: 2 });
    await production.buyAnimal("u1", { animalId: "chicken" });
    expect(repo.createSaveAnimal).toHaveBeenCalledWith(tx, "save-1", "chicken", new Date(T0));
    expect(repo.changeMoney).toHaveBeenCalledWith(tx, "save-1", -150);
  });

  it("alimentar: só os com fome, do mais antigo ao mais novo, enquanto houver ração", async () => {
    repo.findSaveAnimals.mockResolvedValue([
      owned("a1", cow, null),
      owned("a2", chicken, new Date(T0 - 1)),
      owned("a3", cow, null),
      owned("a4", chicken, null),
    ] as never);
    repo.itemCount.mockResolvedValue(3); // dá para a 1ª vaca (2) e a galinha (1); a 2ª vaca fica com fome
    await production.feedAnimals("u1");
    expect(repo.setAnimalsFed).toHaveBeenCalledWith(tx, ["a1", "a4"], new Date(T0));
    expect(repo.removeItem).toHaveBeenCalledWith(tx, "save-1", "feed", 3, 3);
  });

  it("alimentar sem ninguém com fome: 422 NO_HUNGRY_ANIMALS; sem ração: 422 NO_FEED", async () => {
    repo.findSaveAnimals.mockResolvedValue([owned("a1", chicken, new Date(T0))] as never);
    await expect(production.feedAnimals("u1")).rejects.toMatchObject({ code: "NO_HUNGRY_ANIMALS" });
    repo.findSaveAnimals.mockResolvedValue([owned("a1", chicken, null)] as never);
    repo.itemCount.mockResolvedValue(0);
    await expect(production.feedAnimals("u1")).rejects.toMatchObject({ code: "NO_FEED" });
  });

  it("coletar: pega o que ficou pronto (e o esterco) e dá ração de novo; quem fica sem ração fica com fome", async () => {
    repo.findSaveAnimals.mockResolvedValue([
      owned("a1", chicken, new Date(T0 - 60_000)), // pronta
      owned("a2", chicken, new Date(T0 - 59_000)), // ainda não
      owned("a3", cow, new Date(T0 - 120_000)), // pronta
      owned("a4", sheep, new Date(T0 - 60_000)), // pronta, não solta esterco
    ] as never);
    repo.itemCount.mockResolvedValue(1); // só dá para a galinha
    await runAction(production.collectBarnAction());
    expect(repo.addItem).toHaveBeenCalledWith(tx, "save-1", "egg", 1);
    expect(repo.addItem).toHaveBeenCalledWith(tx, "save-1", "milk", 1);
    expect(repo.addItem).toHaveBeenCalledWith(tx, "save-1", "wool", 1);
    expect(repo.addItem).toHaveBeenCalledWith(tx, "save-1", "manure", 3); // 1 da galinha + 2 da vaca
    expect(repo.setAnimalsFed).toHaveBeenCalledWith(tx, ["a1"], new Date(T0));
    expect(repo.setAnimalsFed).toHaveBeenCalledWith(tx, ["a3", "a4"], null);
  });

  it("coletar sem nada pronto: 422 BARN_NOT_READY", async () => {
    repo.findSaveAnimals.mockResolvedValue([owned("a1", chicken, null)] as never);
    await expect(runAction(production.collectBarnAction())).rejects.toMatchObject({ code: "BARN_NOT_READY" });
  });
});
