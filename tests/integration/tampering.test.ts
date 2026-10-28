import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { prisma } from "../../src/shared/database/prisma";
import { as, cleanupTestUsers, createUser } from "../helpers/users";

// Quem intercepta as chamadas (Burp, mitmproxy, DevTools) pode mandar qualquer corpo. O servidor só lê o que o
// schema da rota declara (o resto é descartado), e preço, saldo e quantidade possuída vêm sempre do banco.
// Estes testes fazem o papel desse jogador: nenhum deles pode render dinheiro ou item que o jogo não deu.

beforeAll(cleanupTestUsers);
afterAll(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
});

type Catalog = {
  crops: { id: string; seedPrice: number }[];
  fruits: { id: string; sellPrice: number }[];
};
let catalog: Catalog;
beforeAll(async () => {
  catalog = (await request(app).get("/game/catalog")).body;
});

async function newPlayer(tag: string) {
  const player = await createUser(tag);
  const api = as(player.cookie);
  const save = await prisma.save.findUniqueOrThrow({ where: { userId: player.user.id } });
  const money = async () => (await prisma.save.findUniqueOrThrow({ where: { id: save.id } })).money;
  const give = (itemId: string, quantity: number) =>
    prisma.inventoryItem.upsert({ where: { saveId_itemId: { saveId: save.id, itemId } }, create: { saveId: save.id, itemId, quantity }, update: { quantity } });
  return { ...player, api, save, money, give };
}

const paidCrop = () => catalog.crops.find((c) => c.seedPrice > 0)!;
const fruit = () => catalog.fruits[0];

// Campos que o cliente nunca manda, mas que um corpo adulterado tentaria
const forged = { money: 999_999, price: 0, buyPrice: 0, sellPrice: 999_999, amount: 999_999, userId: "x", saveId: "x" };

describe("corpo adulterado: campos a mais são ignorados", () => {
  it("comprar semente com preço/dinheiro forjados cobra o preço do catálogo", async () => {
    const p = await newPlayer("forge-buy");
    const c = paidCrop();
    const res = await p.api.post("/game/seeds/buy", { cropId: c.id, quantity: 1, ...forged });
    expect(res.status).toBe(200);
    expect(res.body.money).toBe(100 - c.seedPrice);
    expect(await p.money()).toBe(100 - c.seedPrice);
  });

  it("vender com preço de venda forjado paga o preço do catálogo", async () => {
    const p = await newPlayer("forge-sell");
    await p.give(fruit().id, 10);
    const res = await p.api.post("/game/items/sell", { itemId: fruit().id, quantity: 10, ...forged });
    expect(res.status).toBe(200);
    expect(await p.money()).toBe(100 + fruit().sellPrice * 10);
  });

  it("PATCH /auth/me com dinheiro no corpo não mexe no save", async () => {
    const p = await newPlayer("forge-profile");
    const res = await p.api.patch("/auth/me", { displayName: "Hacker", money: 999_999, save: { money: 999_999 } });
    expect(res.status).toBe(200);
    expect(await p.money()).toBe(100);
  });

  it("__proto__ no corpo não passa pela validação nem vira dinheiro", async () => {
    const p = await newPlayer("forge-proto");
    const res = await request(app)
      .post("/game/items/sell")
      .set("Cookie", p.cookie)
      .set("Content-Type", "application/json")
      .send('{"itemId":"corn","__proto__":{"sellPrice":999999},"constructor":{"prototype":{"sellPrice":999999}}}');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ITEM_NOT_SELLABLE");
    expect(await p.money()).toBe(100);
  });
});

describe("quantidade adulterada", () => {
  it("vender 1000 tendo 10 paga só as 10", async () => {
    const p = await newPlayer("qty-inflate");
    await p.give(fruit().id, 10);
    const res = await p.api.post("/game/items/sell", { itemId: fruit().id, quantity: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.money).toBe(100 + fruit().sellPrice * 10);
    expect(res.body.inventory[fruit().id]).toBeUndefined();
  });

  it.each([[0], [-10], [10_000], [1.5], ["10"], [null], [1e308], [{ $gt: 0 }], [[10]]])("vender com quantidade %j: 400 e nada muda", async (quantity) => {
    const p = await newPlayer("qty-bad");
    await p.give(fruit().id, 10);
    const res = await p.api.post("/game/items/sell", { itemId: fruit().id, quantity });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(await p.money()).toBe(100);
  });

  it.each([[-5], [1e308], ["99"]])("comprar com quantidade %j: 400 e nada muda", async (quantity) => {
    const p = await newPlayer("qty-buy");
    const res = await p.api.post("/game/seeds/buy", { cropId: paidCrop().id, quantity });
    expect(res.status).toBe(400);
    expect(await p.money()).toBe(100);
  });
});

describe("requisição repetida (replay) e em paralelo", () => {
  it("a mesma venda disparada 10 vezes ao mesmo tempo paga as frutas uma vez só", async () => {
    const p = await newPlayer("race-sell");
    await p.give(fruit().id, 10);
    const results = await Promise.all(Array.from({ length: 10 }, () => p.api.post("/game/items/sell", { itemId: fruit().id, quantity: 10 })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 422).every((r) => r.body.code === "NOT_ENOUGH_ITEMS")).toBe(true);
    expect(await p.money()).toBe(100 + fruit().sellPrice * 10);
  });

  it("repetir a venda depois de vendido não paga de novo", async () => {
    const p = await newPlayer("replay-sell");
    await p.give(fruit().id, 3);
    await p.api.post("/game/items/sell", { itemId: fruit().id });
    const replay = await p.api.post("/game/items/sell", { itemId: fruit().id });
    expect(replay.status).toBe(422);
    expect(await p.money()).toBe(100 + fruit().sellPrice * 3);
  });
});

describe("dados de outro jogador", () => {
  it("não cancela a tarefa de outro jogador", async () => {
    const victim = await newPlayer("victim");
    const attacker = await newPlayer("attacker");
    await prisma.farmJob.create({ data: { saveId: victim.save.id, action: "move", targetRow: 50, targetCol: 50 } });
    const job = await prisma.farmJob.findFirstOrThrow({ where: { saveId: victim.save.id } });
    const res = await attacker.api.delete(`/game/jobs/${job.id}`);
    expect(res.status).toBe(404);
    expect(await prisma.farmJob.count({ where: { id: job.id } })).toBe(1);
  });

  it("sessão forjada: 401", async () => {
    const res = await request(app).post("/game/items/sell").set("Cookie", "dh_session=forjado").send({ itemId: fruit().id });
    expect(res.status).toBe(401);
  });
});

describe("coordenadas absurdas", () => {
  it.each([[2 ** 40], [-(2 ** 40)], [51]])("tarefa em terreno x=%d: 400 (não 500)", async (x) => {
    const p = await newPlayer("coord");
    const res = await p.api.post("/game/jobs", { action: "till", x, y: 0, tiles: [{ row: 0, col: 0 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});
