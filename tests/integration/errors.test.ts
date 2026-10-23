import { Prisma } from "@prisma/client";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import * as gameRepository from "../../src/modules/game/repositories/game.repository";
import { prisma } from "../../src/shared/database/prisma";
import { as, cleanupTestUsers, createUser, PASSWORD } from "../helpers/users";

beforeAll(cleanupTestUsers);
afterAll(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
});
afterEach(() => vi.restoreAllMocks());

describe("respostas padrão da API", () => {
  it("rota inexistente: 404 em JSON com code ROUTE_NOT_FOUND (qualquer método)", async () => {
    for (const method of ["get", "post", "put", "delete", "patch"] as const) {
      const res = await request(app)[method]("/rota/que/nao/existe");
      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).toMatch(/json/);
      expect(res.body).toMatchObject({ code: "ROUTE_NOT_FOUND" });
    }
  });

  it("toda resposta (inclusive de erro) traz X-Request-Id, igual ao requestId do corpo", async () => {
    const ok = await request(app).get("/health");
    expect(ok.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

    const err = await request(app).get("/auth/me");
    expect(err.body.requestId).toBe(err.headers["x-request-id"]);
  });

  it("JSON quebrado em rota pública e em rota protegida: 400 INVALID_JSON (era 500)", async () => {
    const { cookie } = await createUser("badjson");
    const pub = await request(app).post("/auth/login").set("Content-Type", "application/json").send("{quebrado");
    const priv = await request(app).post("/game/jobs").set("Cookie", cookie).set("Content-Type", "application/json").send('{"x": ');
    for (const res of [pub, priv]) {
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_JSON", error: "O corpo da requisição não é um JSON válido" });
    }
  });

  it("corpo acima de 100kb: 413 PAYLOAD_TOO_LARGE", async () => {
    const res = await request(app).post("/auth/login").send({ email: "a@example.test", password: "x".repeat(150_000) });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("o formato é compatível com o front: error é sempre texto", async () => {
    const responses = [
      await request(app).get("/auth/me"),
      await request(app).post("/auth/login").send({}),
      await request(app).get("/nada"),
    ];
    for (const res of responses) {
      expect(typeof res.body.error).toBe("string");
      expect(typeof res.body.code).toBe("string");
    }
  });
});

describe("falhas de infraestrutura", () => {
  it("banco fora do ar: 503 DATABASE_UNAVAILABLE com Retry-After, sem vazar o host do banco", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma.user, "findUnique").mockRejectedValueOnce(new Prisma.PrismaClientInitializationError("Can't reach database server at 10.9.8.7:5432", "test"));

    const res = await request(app).post("/auth/login").send({ email: "a@example.test", password: PASSWORD });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("DATABASE_UNAVAILABLE");
    expect(res.headers["retry-after"]).toBeTruthy();
    expect(res.text).not.toContain("10.9.8.7");
    expect(log).toHaveBeenCalled(); // 5xx é logado, com o stack
  });

  it("conflito de transação do Postgres (P2034): 503 para o cliente tentar de novo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cookie } = await createUser("p2034");
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "test" }));

    const res = await as(cookie).post("/game/jobs", { action: "till", x: 0, y: 0, tiles: [{ row: 0, col: 0 }] });
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
  });

  it("erro inesperado vira 500 genérico: a mensagem interna não vaza e vai para o log com o requestId", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma.user, "findUnique").mockRejectedValueOnce(new Error("segredo interno: senha=hunter2"));

    const res = await request(app).post("/auth/login").send({ email: "a@example.test", password: PASSWORD });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "Erro interno", code: "INTERNAL_ERROR" });
    expect(res.text).not.toContain("hunter2");
    expect(String(log.mock.calls[0][0])).toContain(res.body.requestId);
  });

  it("depois de uma falha, a API continua respondendo normalmente", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma.user, "findUnique").mockRejectedValueOnce(new Error("falha momentânea"));
    expect((await request(app).post("/auth/login").send({ email: "a@example.test", password: PASSWORD })).status).toBe(500);
    expect((await request(app).get("/health")).status).toBe(200);
  });

  it("falha no meio de uma tarefa do fazendeiro desfaz tudo: o tile plantado, o inventário e a fila voltam ao que eram", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cookie, user } = await createUser("rollback");
    const api = as(cookie);
    await api.post("/game/jobs", { action: "till", x: 0, y: 0, tiles: [{ row: 0, col: 0 }] });
    const before = (await api.get("/game/state")).body;

    // no plantio, o tile é gravado primeiro e a semente é gasta depois: quebra o segundo passo
    vi.spyOn(gameRepository, "removeItem").mockRejectedValueOnce(new Error("explodiu no meio"));
    const res = await api.post("/game/jobs", { action: "plant", x: 0, y: 0, cropId: "corn", tiles: [{ row: 0, col: 0 }] });
    expect(res.status).toBe(500);

    const after = (await api.get("/game/state")).body;
    expect(after.plots[0].grid[0][0].state).toBe("tilled"); // não ficou plantado sem gastar semente
    expect(after.inventory).toEqual(before.inventory);
    expect(after.money).toBe(before.money);
    expect(after.farmer.jobs).toEqual([]); // nem a tarefa ficou na fila
    expect(await prisma.tile.count({ where: { state: "planted", plot: { save: { userId: user.id } } } })).toBe(0);
  });
});
