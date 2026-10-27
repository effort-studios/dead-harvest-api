import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { plotPrice } from "../../src/modules/game/utils/game.constants";
import { prisma } from "../../src/shared/database/prisma";
import { as, cleanupTestUsers, createUser } from "../helpers/users";

beforeAll(cleanupTestUsers);
afterAll(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
});

type Catalog = {
  crops: { id: string; growSeconds: number; harvestItemId: string; harvestPrice: number; seedPrice: number }[];
  fruits: { id: string; sellPrice: number }[];
  trees: { id: string; fruitId: string; fruitsPerHarvest: number; regrowSeconds: number }[];
};
let catalog: Catalog;
beforeAll(async () => {
  catalog = (await request(app).get("/game/catalog")).body;
});

// Jogador novo, já autenticado, com o save no banco à mão para ajustar dinheiro/tempo
async function newPlayer(tag: string) {
  const player = await createUser(tag);
  const api = as(player.cookie);
  const save = await prisma.save.findUniqueOrThrow({ where: { userId: player.user.id } });
  const setMoney = (money: number) => prisma.save.update({ where: { id: save.id }, data: { money } });
  const state = async () => (await api.get("/game/state")).body;
  // Nos testes o fazendeiro anda e age na hora (vitest.config.ts), então enfileirar já executa
  const job = (body: object) => api.post("/game/jobs", body);
  const till = (...pos: [number, number][]) => job({ action: "till", x: 0, y: 0, tiles: tiles(...pos) });
  const plant = (cropId: string, ...pos: [number, number][]) => job({ action: "plant", x: 0, y: 0, cropId, tiles: tiles(...pos) });
  const harvest = (...pos: [number, number][]) => job({ action: "harvest", x: 0, y: 0, tiles: tiles(...pos) });
  const harvestTree = (treeId: string) => job({ action: "harvest_tree", treeId });
  return { ...player, api, save, setMoney, state, job, till, plant, harvest, harvestTree };
}

const tiles = (...pos: [number, number][]) => pos.map(([row, col]) => ({ row, col }));
const crop = () => catalog.crops[0];

describe("GET /game/catalog (público)", () => {
  it("devolve regras do jogo sem exigir login", async () => {
    const res = await request(app).get("/game/catalog");
    expect(res.status).toBe(200);
    expect(res.body.gridSize).toBe(10);
    expect(res.body.crops.length).toBeGreaterThan(0);
    expect(res.body.crops[0]).toEqual(expect.objectContaining({ id: expect.any(String), growSeconds: expect.any(Number), harvestPrice: expect.any(Number), seedPrice: expect.any(Number) }));
    expect(res.body.trees.length).toBeGreaterThan(0);
    expect(res.body.plotPrice).toEqual({ base: 1000, factor: 1.5 });
  });
});

describe("autenticação nas rotas do jogo", () => {
  it.each([
    ["get", "/game/state"],
    ["post", "/game/jobs"],
    ["delete", "/game/jobs"],
    ["delete", "/game/jobs/9b2f6c1e-7d0a-4c52-9f3a-1d2e3f4a5b6c"],
    ["post", "/game/seeds/buy"],
    ["post", "/game/items/sell"],
    ["post", "/game/plots/buy"],
    ["post", "/game/machines/buy"],
    ["post", "/game/machines/start"],
    ["post", "/game/barn/buy"],
    ["post", "/game/barn/expand"],
    ["post", "/game/animals/buy"],
    ["post", "/game/animals/feed"],
  ] as const)("%s %s sem login: 401", async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });
});

describe("GET /game/state", () => {
  it("jogador novo: 1 terreno em 0,0 todo de terra, sementes iniciais e dinheiro", async () => {
    const p = await newPlayer("state");
    const s = await p.state();
    expect(s.plots).toHaveLength(1);
    expect(s.plots[0]).toMatchObject({ x: 0, y: 0 });
    expect(s.plots[0].grid.flat().every((t: { state: string }) => t.state === "soil")).toBe(true);
    expect(s.inventory).toEqual({ corn: 3, tomato: 3, pumpkin: 2 });
    expect(s.money).toBe(100);
    expect(s.day).toBe(1);
    expect(s.serverTime).toBeGreaterThan(0);
  });

  it("cada jogador só vê o próprio jogo", async () => {
    const a = await newPlayer("iso-a");
    const b = await newPlayer("iso-b");
    await a.till([0, 0]);
    expect((await a.state()).plots[0].grid[0][0].state).toBe("tilled");
    expect((await b.state()).plots[0].grid[0][0].state).toBe("soil");
  });
});

describe("POST /game/jobs (fila do fazendeiro)", () => {
  it("arar: enfileira e o servidor executa; devolve o estado novo", async () => {
    const p = await newPlayer("till");
    const res = await p.till([0, 0], [0, 1]);
    expect(res.status).toBe(200);
    expect(res.body.plots[0].grid[0].slice(0, 2).map((t: { state: string }) => t.state)).toEqual(["tilled", "tilled"]);
    expect(res.body.farmer.jobs).toEqual([]); // tudo executado
    expect(res.body.farmer).toMatchObject({ row: 0, col: 1 }); // parou no último tile
  });

  it("arar de novo o mesmo tile: não acontece nada (a regra do jogo recusa e a tarefa some)", async () => {
    const p = await newPlayer("till-twice");
    await p.till([0, 0]);
    const res = await p.till([0, 0]);
    expect(res.status).toBe(200);
    expect(res.body.plots[0].grid[0][0].state).toBe("tilled");
    expect(res.body.farmer.jobs).toEqual([]);
  });

  it("terreno que não é dele: 404 PLOT_NOT_FOUND", async () => {
    const p = await newPlayer("till-plot");
    const res = await p.job({ action: "till", x: 9, y: 9, tiles: tiles([0, 0]) });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PLOT_NOT_FOUND");
  });

  it.each([
    ["lista de tiles vazia", { action: "till", x: 0, y: 0, tiles: [] }],
    ["mais de 10 tiles", { action: "till", x: 0, y: 0, tiles: Array.from({ length: 11 }, (_, i) => ({ row: 0, col: i })) }],
    ["tile repetido", { action: "till", x: 0, y: 0, tiles: tiles([0, 0], [0, 0]) }],
    ["tile fora da malha", { action: "till", x: 0, y: 0, tiles: tiles([10, 0]) }],
    ["tile negativo", { action: "till", x: 0, y: 0, tiles: tiles([-1, 0]) }],
    ["coordenada não inteira", { action: "till", x: 0.5, y: 0, tiles: tiles([0, 0]) }],
    ["sem tiles", { action: "till", x: 0, y: 0 }],
    ["ação desconhecida", { action: "fly", x: 0, y: 0, tiles: tiles([0, 0]) }],
    ["plantio sem planta", { action: "plant", x: 0, y: 0, tiles: tiles([0, 0]) }],
    ["tipo errado", { action: "till", x: "0", y: 0, tiles: tiles([0, 0]) }],
  ])("corpo inválido (%s): 400 'Ação inválida' com detalhes", async (_nome, body) => {
    const p = await newPlayer("job-bad");
    const res = await p.job(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Ação inválida", code: "VALIDATION_ERROR" });
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("as rotas antigas de ação direta não existem mais (só o fazendeiro age)", async () => {
    const p = await newPlayer("old-routes");
    for (const path of ["/game/till", "/game/plant", "/game/harvest", "/game/trees/x/harvest"]) {
      expect((await p.api.post(path, { x: 0, y: 0, tiles: tiles([0, 0]) })).status).toBe(404);
    }
  });
});

describe("plantar pelo fazendeiro", () => {
  it("planta, gasta a semente e o tile fica plantado", async () => {
    const p = await newPlayer("plant");
    await p.till([0, 0]);
    const res = await p.plant("corn", [0, 0]);
    expect(res.status).toBe(200);
    expect(res.body.plots[0].grid[0][0]).toMatchObject({ state: "planted", crop: "corn" });
    expect(res.body.inventory.corn).toBe(2);
  });

  it("planta desconhecida: 400 UNKNOWN_CROP", async () => {
    const p = await newPlayer("plant-unknown");
    const res = await p.plant("bananeira", [0, 0]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_CROP");
  });

  it("terra sem arar: nada é plantado e a semente fica", async () => {
    const p = await newPlayer("plant-soil");
    const res = await p.plant("corn", [5, 5]);
    expect(res.status).toBe(200);
    expect(res.body.plots[0].grid[5][5].state).toBe("soil");
    expect(res.body.inventory.corn).toBe(3);
  });

  it("planta só até acabarem as sementes; o resto da fila é descartado", async () => {
    const p = await newPlayer("plant-seeds");
    await p.till([0, 0], [0, 1], [0, 2], [0, 3], [0, 4]);
    const res = await p.plant("pumpkin", [0, 0], [0, 1], [0, 2], [0, 3]);
    const planted = res.body.plots[0].grid[0].filter((t: { state: string }) => t.state === "planted");
    expect(planted).toHaveLength(2); // só tinha 2 sementes de abóbora
    expect(res.body.inventory.pumpkin).toBeUndefined(); // zerou: a linha some
    expect(res.body.farmer.jobs).toEqual([]);
  });
});

describe("colher pelo fazendeiro", () => {
  async function plantedCorn(tag: string) {
    const p = await newPlayer(tag);
    await p.till([0, 0]);
    await p.plant("corn", [0, 0]);
    return p;
  }
  const growth = (p: { save: { id: string } }, seconds: number) =>
    prisma.tile.updateMany({ where: { plot: { saveId: p.save.id } }, data: { plantedAt: new Date(Date.now() - seconds * 1000), growthAt: new Date(Date.now() - seconds * 1000) } });

  it("planta verde: a colheita é descartada e nada muda", async () => {
    const p = await plantedCorn("harvest-green");
    const res = await p.harvest([0, 0]);
    expect(res.status).toBe(200);
    expect(res.body.money).toBe(100);
    expect(res.body.plots[0].grid[0][0].state).toBe("planted");
    expect(res.body.farmer.jobs).toEqual([]);
  });

  it("madura (5s antes não; no tempo, sim): a colheita vai para o armazém e o tile volta para arado", async () => {
    const p = await plantedCorn("harvest-ripe");
    const corn = catalog.crops.find((c) => c.id === "corn")!;

    await growth(p, corn.growSeconds - 5);
    expect((await p.harvest([0, 0])).body.inventory[corn.harvestItemId]).toBeUndefined();

    await growth(p, corn.growSeconds + 1);
    const res = await p.harvest([0, 0]);
    expect(res.body.money).toBe(100); // colher não paga: vende-se no armazém
    expect(res.body.inventory[corn.harvestItemId]).toBe(1);
    expect(res.body.plots[0].grid[0][0]).toEqual({ state: "tilled", crop: null, growth: 0, fertilized: false, watered: false });

    const sold = await p.api.post("/game/items/sell", { itemId: corn.harvestItemId });
    expect(sold.body.money).toBe(100 + corn.harvestPrice);
  });

  it("colher de novo o mesmo tile não dá duas colheitas", async () => {
    const p = await plantedCorn("harvest-twice");
    await growth(p, 99_999);
    const corn = catalog.crops.find((c) => c.id === "corn")!;
    await p.harvest([0, 0]);
    expect((await p.harvest([0, 0])).body.inventory[corn.harvestItemId]).toBe(1);
  });

  it("terreno inexistente: 404", async () => {
    const p = await newPlayer("harvest-plot");
    expect((await p.job({ action: "harvest", x: 3, y: 3, tiles: tiles([0, 0]) })).status).toBe(404);
  });
});

describe("POST /game/seeds/buy", () => {
  const paid = () => catalog.crops.find((c) => c.seedPrice > 0)!;

  it("compra e desconta o dinheiro", async () => {
    const p = await newPlayer("buy");
    const c = paid();
    const res = await p.api.post("/game/seeds/buy", { cropId: c.id, quantity: 1 });
    expect(res.status).toBe(200);
    expect(res.body.money).toBe(100 - c.seedPrice);
    expect(res.body.inventory[c.id]).toBe(({ corn: 3, tomato: 3, pumpkin: 2 } as Record<string, number>)[c.id] + 1);
  });

  it("dinheiro dá só para parte: compra as que dá", async () => {
    const p = await newPlayer("buy-partial");
    const c = paid();
    await p.setMoney(c.seedPrice * 2 + 1);
    const res = await p.api.post("/game/seeds/buy", { cropId: c.id, quantity: 10 });
    expect(res.status).toBe(200);
    expect(res.body.money).toBe(1);
  });

  it("sem dinheiro nenhum: 422 INSUFFICIENT_FUNDS e nada muda", async () => {
    const p = await newPlayer("buy-broke");
    const c = paid();
    await p.setMoney(c.seedPrice - 1);
    const res = await p.api.post("/game/seeds/buy", { cropId: c.id, quantity: 1 });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "INSUFFICIENT_FUNDS", error: "Dinheiro insuficiente" });
    expect((await p.state()).money).toBe(c.seedPrice - 1);
  });

  it("semente desconhecida: 400 UNKNOWN_SEED", async () => {
    const p = await newPlayer("buy-unknown");
    const res = await p.api.post("/game/seeds/buy", { cropId: "bananeira", quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_SEED");
  });

  it.each([[0], [-1], [100], [1.5], ["2"]])("quantidade inválida (%j): 400", async (quantity) => {
    const p = await newPlayer("buy-qty");
    const res = await p.api.post("/game/seeds/buy", { cropId: "corn", quantity });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /game/items/sell (armazém)", () => {
  const fruit = () => catalog.fruits[0];
  const give = (saveId: string, itemId: string, quantity: number) =>
    prisma.inventoryItem.upsert({ where: { saveId_itemId: { saveId, itemId } }, create: { saveId, itemId, quantity }, update: { quantity } });

  it("sem a fruta: 422 NOT_ENOUGH_ITEMS", async () => {
    const p = await newPlayer("sell-none");
    const res = await p.api.post("/game/items/sell", { itemId: fruit().id });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("NOT_ENOUGH_ITEMS");
  });

  it("sem quantidade vende tudo e paga", async () => {
    const p = await newPlayer("sell-all");
    await give(p.save.id, fruit().id, 5);
    const res = await p.api.post("/game/items/sell", { itemId: fruit().id });
    expect(res.status).toBe(200);
    expect(res.body.money).toBe(100 + fruit().sellPrice * 5);
    expect(res.body.inventory[fruit().id]).toBeUndefined();
  });

  it("com quantidade vende só aquela, e pedir mais do que tem vende o que tem", async () => {
    const p = await newPlayer("sell-some");
    await give(p.save.id, fruit().id, 5);
    const some = await p.api.post("/game/items/sell", { itemId: fruit().id, quantity: 2 });
    expect(some.body.inventory[fruit().id]).toBe(3);
    const more = await p.api.post("/game/items/sell", { itemId: fruit().id, quantity: 99 });
    expect(more.status).toBe(200);
    expect(more.body.money).toBe(100 + fruit().sellPrice * 5);
  });

  it("item que não se vende (semente) ou que não existe: 400 ITEM_NOT_SELLABLE", async () => {
    const p = await newPlayer("sell-bad");
    for (const itemId of ["corn", "nao-existe"]) {
      const res = await p.api.post("/game/items/sell", { itemId });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("ITEM_NOT_SELLABLE");
    }
  });
});

describe("POST /game/plots/buy", () => {
  it("compra o terreno vizinho pelo preço e ele aparece no estado", async () => {
    const p = await newPlayer("plot");
    await p.setMoney(plotPrice(1));
    const res = await p.api.post("/game/plots/buy", { x: 1, y: 0 });
    expect(res.status).toBe(200);
    expect(res.body.money).toBe(0);
    expect(res.body.plots.map((pl: { x: number; y: number }) => [pl.x, pl.y]).sort()).toEqual([[0, 0], [1, 0]]);
  });

  it("o segundo terreno custa mais (+50%)", async () => {
    const p = await newPlayer("plot-price");
    await p.setMoney(plotPrice(1) + plotPrice(2) + 7);
    await p.api.post("/game/plots/buy", { x: 1, y: 0 });
    const res = await p.api.post("/game/plots/buy", { x: 1, y: 1 });
    expect(res.status).toBe(200);
    expect(res.body.money).toBe(7);
  });

  it("sem dinheiro: 422 INSUFFICIENT_FUNDS e nenhum terreno criado (nada fica pela metade)", async () => {
    const p = await newPlayer("plot-broke");
    await p.setMoney(plotPrice(1) - 1);
    const res = await p.api.post("/game/plots/buy", { x: 1, y: 0 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INSUFFICIENT_FUNDS");
    const s = await p.state();
    expect(s.plots).toHaveLength(1);
    expect(s.money).toBe(plotPrice(1) - 1);
  });

  it("longe (ou na diagonal): 422 PLOT_NOT_ADJACENT", async () => {
    const p = await newPlayer("plot-far");
    await p.setMoney(99_999);
    for (const pos of [{ x: 5, y: 5 }, { x: 1, y: 1 }]) {
      const res = await p.api.post("/game/plots/buy", pos);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe("PLOT_NOT_ADJACENT");
    }
  });

  it("terreno que já é dele: 409 PLOT_ALREADY_OWNED", async () => {
    const p = await newPlayer("plot-own");
    await p.setMoney(99_999);
    const res = await p.api.post("/game/plots/buy", { x: 0, y: 0 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PLOT_ALREADY_OWNED");
  });

  it("coordenadas fora do limite (±50): 400", async () => {
    const p = await newPlayer("plot-limit");
    expect((await p.api.post("/game/plots/buy", { x: 51, y: 0 })).status).toBe(400);
  });
});

describe("colher árvore pelo fazendeiro", () => {
  const tree = () => catalog.trees[0];

  it("colhe, dá as frutas e na hora seguinte não colhe de novo (a árvore não repôs)", async () => {
    const p = await newPlayer("tree");
    const first = await p.harvestTree(tree().id);
    expect(first.status).toBe(200);
    expect(first.body.inventory[tree().fruitId]).toBe(tree().fruitsPerHarvest);
    expect(first.body.trees[tree().id]).toBeGreaterThan(0);

    const second = await p.harvestTree(tree().id);
    expect(second.status).toBe(200);
    expect(second.body.inventory[tree().fruitId]).toBe(tree().fruitsPerHarvest); // não ganhou de novo
  });

  it("depois do tempo de rebrota colhe outra vez", async () => {
    const p = await newPlayer("tree-regrow");
    await p.harvestTree(tree().id);
    await prisma.treeHarvest.updateMany({ where: { saveId: p.save.id }, data: { harvestedAt: new Date(Date.now() - (tree().regrowSeconds + 1) * 1000) } });
    const res = await p.harvestTree(tree().id);
    expect(res.body.inventory[tree().fruitId]).toBe(tree().fruitsPerHarvest * 2);
  });

  it("árvore que não existe: 404 TREE_NOT_FOUND", async () => {
    const p = await newPlayer("tree-404");
    const res = await p.harvestTree("naoexiste");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("TREE_NOT_FOUND");
  });

  it("id de árvore gigante: 400 (corpo validado)", async () => {
    const p = await newPlayer("tree-long");
    const res = await p.harvestTree("x".repeat(31));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Ação inválida", code: "VALIDATION_ERROR" });
  });
});

describe("concorrência (o save é travado com FOR UPDATE)", () => {
  it("compras de semente em paralelo nunca gastam mais dinheiro do que existe", async () => {
    const p = await newPlayer("race-buy");
    const c = catalog.crops.find((x) => x.seedPrice > 0)!;
    await p.setMoney(c.seedPrice * 3); // dinheiro para exatamente 3 sementes

    const results = await Promise.all(Array.from({ length: 10 }, () => p.api.post("/game/seeds/buy", { cropId: c.id, quantity: 1 })));
    const ok = results.filter((r) => r.status === 200).length;
    const refused = results.filter((r) => r.status === 422);

    expect(ok).toBe(3);
    expect(refused).toHaveLength(7);
    expect(refused.every((r) => r.body.code === "INSUFFICIENT_FUNDS")).toBe(true);

    const s = await p.state();
    expect(s.money).toBe(0);
    expect(s.inventory[c.id]).toBe(({ corn: 3, tomato: 3, pumpkin: 2 } as Record<string, number>)[c.id] + 3);
  });

  it("enfileirar plantios em paralelo nunca planta mais do que há", async () => {
    const p = await newPlayer("race-plant");
    await p.till([0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]);
    const results = await Promise.all([0, 1, 2, 3, 4, 5].map((col) => p.plant("pumpkin", [0, col])));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const planted = (await p.state()).plots[0].grid[0].filter((t: { state: string }) => t.state === "planted");
    expect(planted).toHaveLength(2); // 2 sementes de abóbora
  });

  it("colher a mesma árvore em paralelo dá as frutas uma vez só", async () => {
    const p = await newPlayer("race-tree");
    const t = catalog.trees[0];
    const results = await Promise.all(Array.from({ length: 6 }, () => p.harvestTree(t.id)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect((await p.state()).inventory[t.fruitId]).toBe(t.fruitsPerHarvest);
  });
});
