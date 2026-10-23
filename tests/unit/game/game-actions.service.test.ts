import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestError, ConflictError, NotFoundError, UnprocessableError } from "../../../src/shared/errors/AppError";

vi.mock("../../../src/modules/game/repositories/game.repository");

import * as gameRepository from "../../../src/modules/game/repositories/game.repository";
import * as actions from "../../../src/modules/game/services/game-actions.service";
import { plotPrice } from "../../../src/modules/game/utils/game.constants";

const repo = vi.mocked(gameRepository);
const tx = { tx: true } as never;
const SAVE = { id: "save-1", money: 500, farmerRow: 4, farmerCol: -1.5, farmerFreeAt: null };
const T0 = Date.UTC(2026, 0, 1);

const tile = (row: number, col: number, over: Record<string, unknown> = {}) => ({ row, col, state: "tilled", cropId: null, plantedAt: null, crop: null, ...over });
const plot = (tiles: ReturnType<typeof tile>[] = []) => ({ id: "plot-1", x: 0, y: 0, tiles }) as never;
const corn = { id: "corn", name: "Milho", seedItemId: "corn-seed", growSeconds: 60, harvestPrice: 40 };

// O save vem do repositório falso; o estado final (resposta da ação) é só um save vazio
function setup(save: Pick<typeof SAVE, "id" | "money"> | null = SAVE) {
  repo.transaction.mockImplementation(((fn: (t: never) => unknown) => fn(tx)) as never);
  repo.lockSave.mockResolvedValue(save as never);
  repo.findSaveState.mockResolvedValue({ gameStartedAt: new Date(T0), money: 0, plots: [], inventory: [], treeHarvests: [], farmerRow: 4, farmerCol: -1.5, farmerFreeAt: null, farmJobs: [] } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  setup();
});

describe("act (comum a todas as ações)", () => {
  it("save inexistente: 404 SAVE_NOT_FOUND, sem tocar em nada", async () => {
    setup(null);
    await expect(actions.till("u1", { x: 0, y: 0, tiles: [{ row: 0, col: 0 }] })).rejects.toMatchObject({ constructor: NotFoundError, code: "SAVE_NOT_FOUND" });
    expect(repo.findPlot).not.toHaveBeenCalled();
  });

  it("devolve o estado novo lido na mesma transação", async () => {
    repo.findPlot.mockResolvedValue(plot());
    const state = await actions.till("u1", { x: 0, y: 0, tiles: [{ row: 0, col: 0 }] });
    expect(state.serverTime).toBe(T0);
    expect(repo.findSaveState).toHaveBeenCalledWith(tx, "u1");
  });

  it("erro de regra propaga e nada é gravado depois dele", async () => {
    repo.findPlot.mockResolvedValue(plot([tile(0, 0)]));
    await expect(actions.till("u1", { x: 0, y: 0, tiles: [{ row: 0, col: 0 }] })).rejects.toThrow();
    expect(repo.createTilledTiles).not.toHaveBeenCalled();
    expect(repo.findSaveState).not.toHaveBeenCalled();
  });
});

describe("till", () => {
  const input = { x: 0, y: 0, tiles: [{ row: 0, col: 0 }, { row: 0, col: 1 }] };

  it("terreno que o jogador não tem: 404 PLOT_NOT_FOUND", async () => {
    repo.findPlot.mockResolvedValue(null);
    await expect(actions.till("u1", input)).rejects.toMatchObject({ constructor: NotFoundError, status: 404, code: "PLOT_NOT_FOUND" });
  });

  it("tudo já arado: 409 TILES_ALREADY_TILLED", async () => {
    repo.findPlot.mockResolvedValue(plot([tile(0, 0), tile(0, 1)]));
    await expect(actions.till("u1", input)).rejects.toMatchObject({ constructor: ConflictError, status: 409, code: "TILES_ALREADY_TILLED" });
  });

  it("ara só o que ainda é terra", async () => {
    repo.findPlot.mockResolvedValue(plot([tile(0, 0)]));
    await actions.till("u1", input);
    expect(repo.createTilledTiles).toHaveBeenCalledWith(tx, "plot-1", [{ row: 0, col: 1 }]);
  });
});

describe("plant", () => {
  const input = { x: 0, y: 0, cropId: "corn", tiles: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }] };

  it("planta desconhecida: 400 UNKNOWN_CROP", async () => {
    repo.findCrop.mockResolvedValue(null);
    await expect(actions.plant("u1", input)).rejects.toMatchObject({ constructor: BadRequestError, status: 400, code: "UNKNOWN_CROP" });
  });

  it("sem tiles arados: 422 TILES_NOT_TILLED", async () => {
    repo.findCrop.mockResolvedValue(corn as never);
    repo.findPlot.mockResolvedValue(plot([]));
    await expect(actions.plant("u1", input)).rejects.toMatchObject({ constructor: UnprocessableError, status: 422, code: "TILES_NOT_TILLED" });
  });

  it("sem sementes: 422 NO_SEEDS", async () => {
    repo.findCrop.mockResolvedValue(corn as never);
    repo.findPlot.mockResolvedValue(plot([tile(0, 0)]));
    repo.itemCount.mockResolvedValue(0);
    await expect(actions.plant("u1", input)).rejects.toMatchObject({ status: 422, code: "NO_SEEDS" });
  });

  it("planta só enquanto houver semente, na ordem pedida, e gasta as sementes", async () => {
    repo.findCrop.mockResolvedValue(corn as never);
    repo.findPlot.mockResolvedValue(plot([tile(0, 0), tile(0, 1), tile(0, 2)]));
    repo.itemCount.mockResolvedValue(2);
    await actions.plant("u1", input);
    expect(repo.plantTiles).toHaveBeenCalledWith(tx, "plot-1", [{ row: 0, col: 0 }, { row: 0, col: 1 }], "corn", new Date(T0));
    expect(repo.removeItem).toHaveBeenCalledWith(tx, "save-1", "corn-seed", 2, 2);
  });

  it("ignora tiles que já têm planta", async () => {
    repo.findCrop.mockResolvedValue(corn as never);
    repo.findPlot.mockResolvedValue(plot([tile(0, 0, { state: "planted" }), tile(0, 1)]));
    repo.itemCount.mockResolvedValue(5);
    await actions.plant("u1", input);
    expect(repo.plantTiles).toHaveBeenCalledWith(tx, "plot-1", [{ row: 0, col: 1 }], "corn", expect.any(Date));
  });
});

describe("harvest", () => {
  const planted = (row: number, col: number, ageSeconds: number) =>
    tile(row, col, { state: "planted", cropId: "corn", plantedAt: new Date(T0 - ageSeconds * 1000), crop: corn });
  const input = { x: 0, y: 0, tiles: [{ row: 0, col: 0 }, { row: 0, col: 1 }] };

  it("nada maduro: 422 CROP_NOT_RIPE", async () => {
    repo.findPlot.mockResolvedValue(plot([planted(0, 0, 10)]));
    await expect(actions.harvest("u1", input)).rejects.toMatchObject({ constructor: UnprocessableError, status: 422, code: "CROP_NOT_RIPE" });
    expect(repo.changeMoney).not.toHaveBeenCalled();
  });

  it("colhe só os maduros e paga a soma", async () => {
    repo.findPlot.mockResolvedValue(plot([planted(0, 0, 60), planted(0, 1, 59)]));
    await actions.harvest("u1", input);
    expect(repo.clearTiles).toHaveBeenCalledWith(tx, "plot-1", [{ row: 0, col: 0, price: 40 }]);
    expect(repo.changeMoney).toHaveBeenCalledWith(tx, "save-1", 40);
  });

  it("vários maduros somam os preços", async () => {
    repo.findPlot.mockResolvedValue(plot([planted(0, 0, 100), planted(0, 1, 100)]));
    await actions.harvest("u1", input);
    expect(repo.changeMoney).toHaveBeenCalledWith(tx, "save-1", 80);
  });
});

describe("buySeed", () => {
  const seedCrop = (buyPrice: number | null) => ({ ...corn, seedItem: { buyPrice } }) as never;

  it("semente desconhecida ou sem preço de compra: 400 UNKNOWN_SEED", async () => {
    repo.findCropWithSeed.mockResolvedValue(null);
    await expect(actions.buySeed("u1", { cropId: "x", quantity: 1 })).rejects.toMatchObject({ constructor: BadRequestError, code: "UNKNOWN_SEED" });
    repo.findCropWithSeed.mockResolvedValue(seedCrop(null));
    await expect(actions.buySeed("u1", { cropId: "corn", quantity: 1 })).rejects.toMatchObject({ code: "UNKNOWN_SEED" });
  });

  it("sem dinheiro para nenhuma: 422 INSUFFICIENT_FUNDS", async () => {
    setup({ id: "save-1", money: 5 });
    repo.findCropWithSeed.mockResolvedValue(seedCrop(10));
    await expect(actions.buySeed("u1", { cropId: "corn", quantity: 3 })).rejects.toMatchObject({ constructor: UnprocessableError, status: 422, code: "INSUFFICIENT_FUNDS" });
    expect(repo.changeMoney).not.toHaveBeenCalled();
    expect(repo.addItem).not.toHaveBeenCalled();
  });

  it("dinheiro dá para parte: compra as que dá", async () => {
    setup({ id: "save-1", money: 25 });
    repo.findCropWithSeed.mockResolvedValue(seedCrop(10));
    await actions.buySeed("u1", { cropId: "corn", quantity: 5 });
    expect(repo.changeMoney).toHaveBeenCalledWith(tx, "save-1", -20);
    expect(repo.addItem).toHaveBeenCalledWith(tx, "save-1", "corn-seed", 2);
  });

  it("semente grátis: compra tudo, sem mexer no dinheiro além de zero", async () => {
    setup({ id: "save-1", money: 0 });
    repo.findCropWithSeed.mockResolvedValue(seedCrop(0));
    await actions.buySeed("u1", { cropId: "corn", quantity: 4 });
    expect(repo.addItem).toHaveBeenCalledWith(tx, "save-1", "corn-seed", 4);
    expect(repo.changeMoney).toHaveBeenCalledWith(tx, "save-1", -0);
  });
});

describe("sellFruit", () => {
  const apple = { id: "apple", name: "Maçã", sellPrice: 7 };

  it("item que não existe ou não se vende: 400 ITEM_NOT_SELLABLE", async () => {
    repo.findItem.mockResolvedValue(null);
    await expect(actions.sellFruit("u1", { itemId: "x" })).rejects.toMatchObject({ constructor: BadRequestError, code: "ITEM_NOT_SELLABLE" });
    repo.findItem.mockResolvedValue({ ...apple, sellPrice: null } as never);
    await expect(actions.sellFruit("u1", { itemId: "apple" })).rejects.toMatchObject({ code: "ITEM_NOT_SELLABLE" });
  });

  it("sem a fruta no inventário: 422 NOT_ENOUGH_ITEMS", async () => {
    repo.findItem.mockResolvedValue(apple as never);
    repo.itemCount.mockResolvedValue(0);
    await expect(actions.sellFruit("u1", { itemId: "apple" })).rejects.toMatchObject({ constructor: UnprocessableError, status: 422, code: "NOT_ENOUGH_ITEMS" });
  });

  it("sem quantidade, vende todas", async () => {
    repo.findItem.mockResolvedValue(apple as never);
    repo.itemCount.mockResolvedValue(6);
    await actions.sellFruit("u1", { itemId: "apple" });
    expect(repo.removeItem).toHaveBeenCalledWith(tx, "save-1", "apple", 6, 6);
    expect(repo.changeMoney).toHaveBeenCalledWith(tx, "save-1", 42);
  });

  it("quantidade maior que o que tem: vende só o que tem", async () => {
    repo.findItem.mockResolvedValue(apple as never);
    repo.itemCount.mockResolvedValue(3);
    await actions.sellFruit("u1", { itemId: "apple", quantity: 10 });
    expect(repo.changeMoney).toHaveBeenCalledWith(tx, "save-1", 21);
  });
});

describe("buyPlot", () => {
  it("terreno que já é do jogador: 409 PLOT_ALREADY_OWNED", async () => {
    repo.findPlotPositions.mockResolvedValue([{ x: 0, y: 0 }]);
    await expect(actions.buyPlot("u1", { x: 0, y: 0 })).rejects.toMatchObject({ constructor: ConflictError, status: 409, code: "PLOT_ALREADY_OWNED" });
  });

  it("longe dos terrenos dele (diagonal não conta): 422 PLOT_NOT_ADJACENT", async () => {
    repo.findPlotPositions.mockResolvedValue([{ x: 0, y: 0 }]);
    await expect(actions.buyPlot("u1", { x: 1, y: 1 })).rejects.toMatchObject({ constructor: UnprocessableError, status: 422, code: "PLOT_NOT_ADJACENT" });
    await expect(actions.buyPlot("u1", { x: 5, y: 5 })).rejects.toMatchObject({ code: "PLOT_NOT_ADJACENT" });
  });

  it("sem dinheiro: 422 INSUFFICIENT_FUNDS e nada criado", async () => {
    setup({ id: "save-1", money: plotPrice(1) - 1 });
    repo.findPlotPositions.mockResolvedValue([{ x: 0, y: 0 }]);
    await expect(actions.buyPlot("u1", { x: 1, y: 0 })).rejects.toMatchObject({ status: 422, code: "INSUFFICIENT_FUNDS" });
    expect(repo.createPlot).not.toHaveBeenCalled();
    expect(repo.changeMoney).not.toHaveBeenCalled();
  });

  it("compra o terreno vizinho pelo preço de quem já tem N terrenos", async () => {
    setup({ id: "save-1", money: 99_999 });
    repo.findPlotPositions.mockResolvedValue([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    await actions.buyPlot("u1", { x: 1, y: 1 });
    expect(repo.createPlot).toHaveBeenCalledWith(tx, "save-1", 1, 1);
    expect(repo.changeMoney).toHaveBeenCalledWith(tx, "save-1", -plotPrice(2));
  });
});

describe("harvestTree", () => {
  const tree = { id: "t1", fruitItemId: "apple", fruitsPerHarvest: 4, regrowSeconds: 120 };

  it("árvore que não existe: 404 TREE_NOT_FOUND", async () => {
    repo.findTree.mockResolvedValue(null);
    await expect(actions.harvestTree("u1", "x")).rejects.toMatchObject({ constructor: NotFoundError, status: 404, code: "TREE_NOT_FOUND" });
  });

  it("colhida há pouco: 422 TREE_NOT_READY", async () => {
    repo.findTree.mockResolvedValue(tree as never);
    repo.findTreeHarvest.mockResolvedValue({ harvestedAt: new Date(T0 - 119_000) } as never);
    await expect(actions.harvestTree("u1", "t1")).rejects.toMatchObject({ constructor: UnprocessableError, status: 422, code: "TREE_NOT_READY" });
    expect(repo.addItem).not.toHaveBeenCalled();
  });

  it("primeira colheita e colheita depois da rebrota dão as frutas", async () => {
    repo.findTree.mockResolvedValue(tree as never);
    repo.findTreeHarvest.mockResolvedValue(null);
    await actions.harvestTree("u1", "t1");
    repo.findTreeHarvest.mockResolvedValue({ harvestedAt: new Date(T0 - 120_000) } as never);
    await actions.harvestTree("u1", "t1");
    expect(repo.addItem).toHaveBeenCalledTimes(2);
    expect(repo.addItem).toHaveBeenCalledWith(tx, "save-1", "apple", 4);
    expect(repo.saveTreeHarvest).toHaveBeenCalledWith(tx, "save-1", "t1", new Date(T0));
  });
});
