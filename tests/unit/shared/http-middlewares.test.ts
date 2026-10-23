import type { Request, Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { TooManyRequestsError } from "../../../src/shared/errors/AppError";
import { asyncHandler } from "../../../src/shared/http/asyncHandler";
import { rateLimit } from "../../../src/shared/http/rateLimit";
import { validate } from "../../../src/shared/http/validate";
import { buildApp } from "../../helpers/http";

describe("requestId", () => {
  it("gera um id diferente por requisição e ignora o que o cliente mandar", async () => {
    const app = buildApp((r) => r.get("/x", (_req, res) => void res.json({ ok: true })));
    const a = await request(app).get("/x").set("X-Request-Id", "forjado");
    const b = await request(app).get("/x");
    expect(a.headers["x-request-id"]).not.toBe("forjado");
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
  });
});

describe("asyncHandler", () => {
  it("rejeição de promise cai no errorHandler (sem requisição pendurada)", async () => {
    const app = buildApp((r) =>
      r.get(
        "/x",
        asyncHandler(async () => {
          throw new TooManyRequestsError(1);
        }),
      ),
    );
    const res = await request(app).get("/x");
    expect(res.status).toBe(429);
  });

  it("caminho feliz responde normalmente", async () => {
    const app = buildApp((r) =>
      r.get(
        "/x",
        asyncHandler(async (_req, res) => {
          res.json({ ok: true });
        }),
      ),
    );
    expect((await request(app).get("/x")).body).toEqual({ ok: true });
  });
});

describe("validate", () => {
  const body = z.object({ name: z.string().trim().min(2, "Nome muito curto"), n: z.number().int() });

  it("troca o body pelo valor tratado pelo schema", async () => {
    const app = buildApp((r) => r.post("/x", validate({ body }), (req, res) => void res.json(req.body)));
    const res = await request(app).post("/x").send({ name: "  Ana  ", n: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "Ana", n: 3 });
  });

  it("inválido: 400 com a primeira mensagem do schema e os detalhes por campo", async () => {
    const app = buildApp((r) => r.post("/x", validate({ body }), (_req, res) => void res.json({})));
    const res = await request(app).post("/x").send({ name: "a", n: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.error).toBe("Nome muito curto");
    expect(res.body.details.map((d: { path: string }) => d.path)).toEqual(["name", "n"]);
  });

  it("com `message`, o jogador vê a mensagem da rota e os detalhes continuam técnicos", async () => {
    const app = buildApp((r) => r.post("/x", validate({ body, message: "Ação inválida" }), (_req, res) => void res.json({})));
    const res = await request(app).post("/x").send({ name: "a", n: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Ação inválida", code: "VALIDATION_ERROR" });
    expect(res.body.details).toHaveLength(2);
  });

  it("sem corpo nenhum, valida como objeto vazio (400 em vez de 500)", async () => {
    const app = buildApp((r) => r.post("/x", validate({ body }), (_req, res) => void res.json({})));
    const res = await request(app).post("/x");
    expect(res.status).toBe(400);
  });

  it("valida e troca os parâmetros da rota", async () => {
    const params = z.object({ id: z.string().min(3, "Id inválido") });
    const app = buildApp((r) => r.get("/t/:id", validate({ params }), (req, res) => void res.json(req.params)));
    expect((await request(app).get("/t/abc")).body).toEqual({ id: "abc" });
    const bad = await request(app).get("/t/ab");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("Id inválido");
  });

  it("valida e troca a query", async () => {
    const query = z.object({ page: z.coerce.number().int().min(1) });
    const app = buildApp((r) => r.get("/q", validate({ query }), (req, res) => void res.json(req.query)));
    expect((await request(app).get("/q?page=2")).body).toEqual({ page: 2 });
    expect((await request(app).get("/q?page=0")).status).toBe(400);
  });
});

describe("rateLimit", () => {
  const fakeReq = (ip = "1.1.1.1") => ({ ip, body: {} }) as unknown as Request;
  const res = {} as Response;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("deixa passar até `max` e bloqueia o resto com 429 + Retry-After", () => {
    const limit = rateLimit({ windowMs: 60_000, max: 2 });
    const next = vi.fn();
    limit(fakeReq(), res, next);
    limit(fakeReq(), res, next);
    expect(next.mock.calls).toEqual([[], []]);

    limit(fakeReq(), res, next);
    const err = next.mock.calls[2][0];
    expect(err).toBeInstanceOf(TooManyRequestsError);
    expect(err.status).toBe(429);
    expect(err.headers["Retry-After"]).toBe("60");
  });

  it("a janela reinicia depois do tempo", () => {
    const limit = rateLimit({ windowMs: 60_000, max: 1 });
    const next = vi.fn();
    limit(fakeReq(), res, next);
    limit(fakeReq(), res, next);
    expect(next.mock.calls[1][0]).toBeInstanceOf(TooManyRequestsError);

    vi.advanceTimersByTime(60_001);
    limit(fakeReq(), res, next);
    expect(next.mock.calls[2]).toEqual([]);
  });

  it("conta cada chave separadamente", () => {
    const limit = rateLimit({ windowMs: 60_000, max: 1 });
    const next = vi.fn();
    limit(fakeReq("1.1.1.1"), res, next);
    limit(fakeReq("2.2.2.2"), res, next);
    expect(next.mock.calls).toEqual([[], []]);
  });

  it("aceita uma função de chave própria", () => {
    const limit = rateLimit({ windowMs: 60_000, max: 1, key: (req) => String(req.body.email) });
    const next = vi.fn();
    limit({ ip: "1.1.1.1", body: { email: "a@a.com" } } as Request, res, next);
    limit({ ip: "1.1.1.1", body: { email: "b@b.com" } } as Request, res, next);
    limit({ ip: "9.9.9.9", body: { email: "a@a.com" } } as Request, res, next);
    expect(next.mock.calls[0]).toEqual([]);
    expect(next.mock.calls[1]).toEqual([]);
    expect(next.mock.calls[2][0]).toBeInstanceOf(TooManyRequestsError);
  });
});
