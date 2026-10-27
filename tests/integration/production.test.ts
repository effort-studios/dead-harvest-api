import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { prisma } from "../../src/shared/database/prisma";
import { as, cleanupTestUsers, createUser } from "../helpers/users";

// Armazém, máquinas e celeiro, de ponta a ponta (HTTP + banco). Nos testes o fazendeiro anda e age na hora
// (vitest.config.ts), então enfileirar uma coleta já executa.

beforeAll(cleanupTestUsers);
afterAll(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
});

type Recipe = { id: string; outputItemId: string; outputQuantity: number; seconds: number; inputs: { itemId: string; quantity: number }[] };
type Catalog = {
  crops: { id: string; growSeconds: number; harvestItemId: string; harvestPrice: number }[];
  items: { id: string; kind: string; name: string; sellPrice: number | null }[];
  machines: { id: string; buyPrice: number; size: number; queueSize: number; recipes: Recipe[] }[];
  animals: { id: string; buyPrice: number; feedItemId: string; feedQuantity: number; productItemId: string; produceSeconds: number; byproductItemId: string | null; byproductQuantity: number }[];
  barn: { price: number; startCapacity: number; maxCapacity: number };
  layout: { barnFootprint: { r0: number; r1: number; c0: number; c1: number } };
};
let catalog: Catalog;
beforeAll(async () => {
  catalog = (await request(app).get("/game/catalog")).body;
});

async function newPlayer(tag: string, money = 100_000) {
  const player = await createUser(tag);
  const api = as(player.cookie);
  const save = await prisma.save.update({ where: { userId: player.user.id }, data: { money } });
  const give = (itemId: string, quantity: number) =>
    prisma.inventoryItem.upsert({ where: { saveId_itemId: { saveId: save.id, itemId } }, create: { saveId: save.id, itemId, quantity }, update: { quantity } });
  const state = async () => (await api.get("/game/state")).body;
  return { ...player, api, save, give, state };
}

// Lugares livres no terreno inicial (0,0) onde os testes constroem (o adubo usa o tile 0,0)
const SPOTS: Record<string, { row: number; col: number }> = { mill: { row: 1, col: 1 }, juicer: { row: 1, col: 7 }, barn: { row: 6, col: 2 } };
type Player = Awaited<ReturnType<typeof newPlayer>>;
const buyMachine = (p: Player, machineId: string) => p.api.post("/game/machines/buy", { machineId, ...SPOTS[machineId] });
const buyBarn = (p: Player) => p.api.post("/game/barn/buy", SPOTS.barn);

const machine = (id: string) => catalog.machines.find((m) => m.id === id)!;
const recipe = (id: string) => catalog.machines.flatMap((m) => m.recipes).find((r) => r.id === id)!;
const sellPrice = (itemId: string) => catalog.items.find((i) => i.id === itemId)?.sellPrice ?? null;

describe("catálogo de produção", () => {
  it("toda receita usa e produz itens que existem, e o produto vale mais que os ingredientes", () => {
    const ids = new Set(catalog.items.map((i) => i.id));
    for (const m of catalog.machines) {
      expect(m.recipes.length).toBeGreaterThan(0);
      for (const r of m.recipes) {
        expect(ids.has(r.outputItemId)).toBe(true);
        for (const i of r.inputs) expect(ids.has(i.itemId)).toBe(true);
        const out = sellPrice(r.outputItemId);
        if (out === null) continue; // ração e adubo: não se vendem
        const raw = r.inputs.reduce((sum, i) => sum + (sellPrice(i.itemId) ?? 0) * i.quantity, 0);
        expect(out * r.outputQuantity, r.id).toBeGreaterThan(raw);
      }
    }
  });

  it("cada colheita é um item do armazém com o preço que a colheita pagava", () => {
    for (const c of catalog.crops) {
      expect(catalog.items.find((i) => i.id === c.harvestItemId)).toMatchObject({ kind: "crop", sellPrice: c.harvestPrice });
    }
  });

  it("galinha e vaca soltam esterco, que a Composteira transforma em adubo", () => {
    const by = (id: string) => catalog.animals.find((a) => a.id === id)!;
    expect(by("chicken")).toMatchObject({ byproductItemId: "manure", byproductQuantity: 1 });
    expect(by("cow")).toMatchObject({ byproductItemId: "manure", byproductQuantity: 2 });
    expect(by("sheep")).toMatchObject({ byproductItemId: null, byproductQuantity: 0 });
    expect(recipe("manure_fertilizer")).toMatchObject({ outputItemId: "fertilizer", outputQuantity: 3, inputs: [{ itemId: "manure", quantity: 2 }] });
  });

  it("cada máquina tem um tamanho que condiz com ela: a prensa de sucos é pequena, o moinho é grande", () => {
    for (const m of catalog.machines) expect(m.size, m.id).toBeGreaterThanOrEqual(1);
    expect(machine("juicer").size).toBe(1);
    expect(machine("mill").size).toBe(2);
  });
});

describe("construir e mover prédios", () => {
  type Api = ReturnType<typeof as>;
  const move = (api: Api, body: object) => api.post("/game/buildings/move", body);
  const tile = async (p: Player, row: number, col: number) => (await p.state()).plots[0].grid[row][col].state;

  it("a máquina é construída onde o jogador escolheu, muda de lugar e o fazendeiro coleta lá", async () => {
    const p = await newPlayer("move-machine");
    expect((await buyMachine(p, "mill")).body.machines.mill).toMatchObject(SPOTS.mill);

    const res = await move(p.api, { kind: "machine", machineId: "mill", row: 4, col: 6 });
    expect(res.status).toBe(200);
    expect(res.body.machines.mill).toMatchObject({ row: 4, col: 6 });

    await p.give("corn_harvest", 3);
    await p.api.post("/game/machines/start", { recipeId: "cornmeal" });
    await prisma.machineJob.updateMany({ where: { saveId: p.save.id }, data: { startsAt: new Date(Date.now() - 100_000_000), readyAt: new Date(Date.now() - 1000) } });
    const collected = await p.api.post("/game/jobs", { action: "collect_machine", machineId: "mill" });
    expect(collected.body.inventory.cornmeal).toBe(1);
    expect(collected.body.farmer).toMatchObject({ row: 6, col: 8 }); // na frente do moinho (2x2), no lugar novo
  });

  it("o celeiro é construído onde o jogador escolheu e muda de lugar", async () => {
    const p = await newPlayer("move-barn");
    expect((await p.state()).barn).toMatchObject({ row: null, col: null, capacity: 0 });
    const before = await move(p.api, { kind: "barn", row: 6, col: 3 });
    expect([before.status, before.body.code]).toEqual([422, "NO_BARN"]);
    expect((await buyBarn(p)).body.barn).toMatchObject({ ...SPOTS.barn, capacity: catalog.barn.startCapacity });
    const res = await move(p.api, { kind: "barn", row: 6, col: 3 });
    expect(res.status).toBe(200);
    expect(res.body.barn).toMatchObject({ row: 6, col: 3 });
  });

  it("só dentro dos terrenos do jogador, sem terra arada nem outro prédio: 422 PLACE_BLOCKED", async () => {
    const p = await newPlayer("place-blocked");
    await buyBarn(p);
    await p.api.post("/game/jobs", { action: "till", x: 0, y: 0, tiles: [{ row: 3, col: 3 }] });
    // fora do terreno; metade para fora (o moinho é 2x2); em cima da terra arada; em cima do celeiro
    for (const [row, col] of [[-3, -3], [9, 9], [3, 3], [6, 3]]) {
      const res = await p.api.post("/game/machines/buy", { machineId: "mill", row, col });
      expect([res.status, res.body.code], `${row},${col}`).toEqual([422, "PLACE_BLOCKED"]);
    }
    expect((await p.state()).machines).toEqual({}); // nada construído, nada pago
    expect((await p.state()).money).toBe(100_000 - catalog.barn.price);
    // com o terreno vizinho comprado, o prédio pode ficar entre os dois
    await p.api.post("/game/plots/buy", { x: 1, y: 0 });
    expect((await p.api.post("/game/machines/buy", { machineId: "mill", row: 1, col: 9 })).status).toBe(200);
    // mover também confere
    const res = await move(p.api, { kind: "machine", machineId: "mill", row: 6, col: 4 });
    expect([res.status, res.body.code]).toEqual([422, "PLACE_BLOCKED"]);
    expect((await p.state()).machines.mill).toMatchObject({ row: 1, col: 9 });
  });

  it("embaixo de prédio não se ara", async () => {
    const p = await newPlayer("till-under");
    await buyMachine(p, "mill");
    await p.api.post("/game/jobs", { action: "till", x: 0, y: 0, tiles: [{ row: 1, col: 1 }, { row: 3, col: 3 }] });
    expect(await tile(p, 1, 1)).toBe("soil");
    expect(await tile(p, 3, 3)).toBe("tilled");
  });

  it("máquina que não é sua não se move; e não muda enquanto o fazendeiro vai coletar nela", async () => {
    const p = await newPlayer("move-busy");
    const notMine = await move(p.api, { kind: "machine", machineId: "mill", row: 4, col: 6 });
    expect([notMine.status, notMine.body.code]).toEqual([422, "MACHINE_NOT_OWNED"]);
    await buyMachine(p, "mill");
    await prisma.farmJob.create({ data: { saveId: p.save.id, action: "collect_machine", machineId: "mill", targetRow: 0, targetCol: 0 } });
    const busy = await move(p.api, { kind: "machine", machineId: "mill", row: 4, col: 6 });
    expect([busy.status, busy.body.code]).toEqual([422, "BUILDING_BUSY"]);
    await prisma.farmJob.deleteMany({ where: { saveId: p.save.id } });
  });
});

describe("máquinas", () => {
  it("comprar, produzir, coletar com o fazendeiro e vender", async () => {
    const p = await newPlayer("mill");
    const mill = machine("mill");
    const cornmeal = recipe("cornmeal");

    const bought = await buyMachine(p, "mill");
    expect(bought.status).toBe(200);
    expect(bought.body.money).toBe(100_000 - mill.buyPrice);
    expect(bought.body.machines).toEqual({ mill: { ...SPOTS.mill, jobs: [] } });
    expect((await buyMachine(p, "mill")).body.code).toBe("MACHINE_ALREADY_OWNED");

    expect((await p.api.post("/game/machines/start", { recipeId: "cornmeal" })).body.code).toBe("NOT_ENOUGH_ITEMS");
    await p.give("corn_harvest", 4);
    const started = await p.api.post("/game/machines/start", { recipeId: "cornmeal" });
    expect(started.status).toBe(200);
    expect(started.body.inventory.corn_harvest).toBe(1);
    const [job] = started.body.machines.mill.jobs;
    expect(job.readyAt - job.startsAt).toBe(cornmeal.seconds * 1000);

    // ainda não ficou pronto: a coleta é descartada
    const early = await p.api.post("/game/jobs", { action: "collect_machine", machineId: "mill" });
    expect(early.status).toBe(200);
    expect(early.body.inventory.cornmeal).toBeUndefined();
    expect(early.body.machines.mill.jobs).toHaveLength(1);

    await prisma.machineJob.updateMany({ where: { saveId: p.save.id }, data: { startsAt: new Date(Date.now() - 100_000_000), readyAt: new Date(Date.now() - 1000) } });
    const collected = await p.api.post("/game/jobs", { action: "collect_machine", machineId: "mill" });
    expect(collected.body.inventory.cornmeal).toBe(1);
    expect(collected.body.machines.mill.jobs).toEqual([]);

    const sold = await p.api.post("/game/items/sell", { itemId: "cornmeal" });
    expect(sold.body.money).toBe(100_000 - mill.buyPrice + sellPrice("cornmeal")!);
  });

  it("a fila tem tamanho: a receita seguinte começa quando a anterior fica pronta", async () => {
    const p = await newPlayer("queue");
    await buyMachine(p, "juicer");
    await p.give("apple", 99);
    const first = await p.api.post("/game/machines/start", { recipeId: "apple_juice" });
    const second = await p.api.post("/game/machines/start", { recipeId: "apple_juice" });
    const [a, b] = second.body.machines.juicer.jobs;
    expect(first.status).toBe(200);
    expect(b.startsAt).toBe(a.readyAt);
    const full = await p.api.post("/game/machines/start", { recipeId: "apple_juice" });
    expect(full.status).toBe(422);
    expect(full.body.code).toBe("MACHINE_QUEUE_FULL");
    expect(machine("juicer").queueSize).toBe(2);
  });

  it("sem a máquina: produzir 422 MACHINE_NOT_OWNED; coletar não entra na fila", async () => {
    const p = await newPlayer("not-owned");
    await p.give("apple", 3);
    expect((await p.api.post("/game/machines/start", { recipeId: "apple_juice" })).body.code).toBe("MACHINE_NOT_OWNED");
    const res = await p.api.post("/game/jobs", { action: "collect_machine", machineId: "juicer" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("MACHINE_NOT_OWNED");
    expect((await p.api.post("/game/jobs", { action: "collect_machine", machineId: "nope" })).status).toBe(404);
  });
});

describe("celeiro", () => {
  it("comprar, ampliar, ter animais, alimentar e coletar (com a ração de novo)", async () => {
    const p = await newPlayer("barn");
    expect((await p.api.post("/game/animals/buy", { animalId: "chicken" })).body.code).toBe("NO_BARN");
    expect((await p.api.post("/game/jobs", { action: "collect_barn" })).body.code).toBe("NO_BARN");

    const barn = await buyBarn(p);
    expect(barn.body.barn).toEqual({ ...SPOTS.barn, capacity: catalog.barn.startCapacity, animals: [] });
    expect(barn.body.money).toBe(100_000 - catalog.barn.price);
    expect((await p.api.post("/game/barn/expand")).body.barn.capacity).toBe(catalog.barn.startCapacity + 2);

    const chicken = catalog.animals.find((a) => a.id === "chicken")!;
    const bought = await p.api.post("/game/animals/buy", { animalId: "chicken" });
    expect(bought.body.barn.animals).toEqual([{ id: expect.any(String), animalId: "chicken", fedAt: null }]);

    expect((await p.api.post("/game/animals/feed")).body.code).toBe("NO_FEED");
    await p.give(chicken.feedItemId, 2);
    const fed = await p.api.post("/game/animals/feed");
    expect(fed.body.barn.animals[0].fedAt).toEqual(expect.any(Number));
    expect(fed.body.inventory[chicken.feedItemId]).toBe(1);
    expect((await p.api.post("/game/animals/feed")).body.code).toBe("NO_HUNGRY_ANIMALS");

    // cedo demais: a coleta é descartada
    expect((await p.api.post("/game/jobs", { action: "collect_barn" })).body.inventory.egg).toBeUndefined();

    await prisma.saveAnimal.updateMany({ where: { saveId: p.save.id }, data: { fedAt: new Date(Date.now() - chicken.produceSeconds * 1000 - 1000) } });
    const collected = await p.api.post("/game/jobs", { action: "collect_barn" });
    expect(collected.body.inventory.egg).toBe(1);
    expect(collected.body.inventory.manure).toBe(1); // a galinha solta esterco junto
    expect(collected.body.inventory[chicken.feedItemId]).toBeUndefined(); // comeu a última ração
    expect(collected.body.barn.animals[0].fedAt).toBeGreaterThan(Date.now() - 60_000);
  });

  it("celeiro cheio: 422 BARN_FULL", async () => {
    const p = await newPlayer("barn-full");
    await buyBarn(p);
    for (let i = 0; i < catalog.barn.startCapacity; i++) await p.api.post("/game/animals/buy", { animalId: "chicken" });
    const res = await p.api.post("/game/animals/buy", { animalId: "chicken" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("BARN_FULL");
  });
});

describe("adubo", () => {
  it("adubar a terra arada faz a planta crescer 30% mais rápido; a colheita tira o adubo", async () => {
    const p = await newPlayer("fertilizer");
    const corn = catalog.crops.find((c) => c.id === "corn")!;
    const job = (body: object) => p.api.post("/game/jobs", { x: 0, y: 0, tiles: [{ row: 0, col: 0 }], ...body });

    expect((await job({ action: "fertilize" })).body.plots[0].grid[0][0].fertilized).toBe(false); // terra: descartado
    await job({ action: "till" });
    expect((await job({ action: "fertilize" })).body.plots[0].grid[0][0].fertilized).toBe(false); // sem adubo
    await p.give("fertilizer", 2);
    const fertilized = await job({ action: "fertilize" });
    expect(fertilized.body.plots[0].grid[0][0]).toEqual({ state: "tilled", crop: null, growth: 0, fertilized: true, watered: false });
    expect(fertilized.body.inventory.fertilizer).toBe(1);

    await job({ action: "plant", cropId: "corn" });
    const faster = Math.ceil(corn.growSeconds / 1.3) + 1;
    await prisma.tile.updateMany({ where: { plot: { saveId: p.save.id } }, data: { plantedAt: new Date(Date.now() - faster * 1000), growthAt: new Date(Date.now() - faster * 1000) } });
    const harvested = await job({ action: "harvest" });
    expect(harvested.body.inventory[corn.harvestItemId]).toBe(1);
    expect(harvested.body.plots[0].grid[0][0]).toEqual({ state: "tilled", crop: null, growth: 0, fertilized: false, watered: false });
  });
});

describe("regador e poço", () => {
  it("compra o regador, rega a planta já plantada, esvazia e enche no poço", async () => {
    const p = await newPlayer("water");
    const job = (body: object) => p.api.post("/game/jobs", { x: 0, y: 0, tiles: [{ row: 0, col: 0 }], ...body });

    expect((await p.api.post("/game/tools/can/buy")).body.canCharges).toBe(10);
    expect((await p.api.post("/game/tools/can/buy")).body.code).toBe("CAN_ALREADY_OWNED");

    await job({ action: "till" });
    await job({ action: "plant", cropId: "corn" });
    const watered = await job({ action: "water" });
    expect(watered.body.plots[0].grid[0][0]).toMatchObject({ state: "planted", watered: true });
    expect(watered.body.canCharges).toBe(9);

    // sem poço não enche
    expect((await p.api.post("/game/jobs", { action: "refill_can" })).body.code).toBe("NO_WELL");
    expect((await p.api.post("/game/well/buy", { row: 5, col: 5 })).body.well).toEqual({ row: 5, col: 5 });
    const refilled = await p.api.post("/game/jobs", { action: "refill_can" });
    expect(refilled.body.canCharges).toBe(10);
    expect(refilled.body.farmer).toMatchObject({ row: 6, col: 6 }); // foi até o poço
  });

  it("adubar depois de plantar também vale", async () => {
    const p = await newPlayer("fertilize-late");
    const job = (body: object) => p.api.post("/game/jobs", { x: 0, y: 0, tiles: [{ row: 0, col: 0 }], ...body });
    await job({ action: "till" });
    await job({ action: "plant", cropId: "corn" });
    await p.give("fertilizer", 1);
    expect((await job({ action: "fertilize" })).body.plots[0].grid[0][0]).toMatchObject({ state: "planted", fertilized: true });
  });
});

