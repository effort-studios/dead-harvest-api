import { Prisma } from "@prisma/client";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  UnprocessableError,
} from "../../../src/shared/errors/AppError";
import { toHttpError } from "../../../src/shared/http/errorHandler";
import { buildApp } from "../../helpers/http";

const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError("falha interna do prisma", { code, clientVersion: "test" });

describe("toHttpError", () => {
  it.each([
    [new BadRequestError("ruim", "RUIM"), 400, "RUIM"],
    [new UnauthorizedError(), 401, "UNAUTHENTICATED"],
    [new ForbiddenError(), 403, "FORBIDDEN"],
    [new NotFoundError(), 404, "NOT_FOUND"],
    [new ConflictError("já existe", "DUP"), 409, "DUP"],
    [new UnprocessableError("não pode", "REGRA"), 422, "REGRA"],
    [new TooManyRequestsError(30), 429, "TOO_MANY_REQUESTS"],
  ])("AppError %# usa o status e o code do próprio erro", (err, status, code) => {
    expect(toHttpError(err)).toMatchObject({ status, code });
  });

  it("TooManyRequestsError manda Retry-After", () => {
    expect(toHttpError(new TooManyRequestsError(42)).headers).toEqual({ "Retry-After": "42" });
  });

  it("AppError genérico mantém details e headers", () => {
    const err = new AppError(418, "TEAPOT", "sou um bule", { a: 1 }, { "X-A": "b" });
    expect(toHttpError(err)).toEqual({ status: 418, code: "TEAPOT", message: "sou um bule", details: { a: 1 }, headers: { "X-A": "b" } });
  });

  it("ZodError vira 400 VALIDATION_ERROR, com a primeira mensagem e os detalhes por campo", () => {
    const parsed = z.object({ email: z.string().email("E-mail inválido"), age: z.number("Idade inválida") }).safeParse({ email: "x", age: "y" });
    const http = toHttpError(parsed.error);
    expect(http).toMatchObject({ status: 400, code: "VALIDATION_ERROR", message: "E-mail inválido" });
    expect(http.details).toEqual([
      { path: "email", message: "E-mail inválido" },
      { path: "age", message: "Idade inválida" },
    ]);
  });

  it.each([
    ["P2002", 409, "ALREADY_EXISTS"],
    ["P2003", 409, "RELATION_CONFLICT"],
    ["P2014", 409, "RELATION_CONFLICT"],
    ["P2025", 404, "NOT_FOUND"],
    ["P2034", 503, "DATABASE_UNAVAILABLE"],
    ["P2024", 503, "DATABASE_UNAVAILABLE"],
    ["P1008", 503, "DATABASE_UNAVAILABLE"],
    ["P1001", 503, "DATABASE_UNAVAILABLE"],
    ["P1002", 503, "DATABASE_UNAVAILABLE"],
    ["P1017", 503, "DATABASE_UNAVAILABLE"],
    ["P9999", 500, "INTERNAL_ERROR"],
  ])("Prisma %s vira %i %s", (prismaCode, status, code) => {
    expect(toHttpError(prismaError(prismaCode))).toMatchObject({ status, code });
  });

  it("503 do banco manda Retry-After", () => {
    expect(toHttpError(prismaError("P2034")).headers).toHaveProperty("Retry-After");
  });

  it("banco que nem inicializa vira 503", () => {
    const err = new Prisma.PrismaClientInitializationError("não conectou em 10.0.0.1:5432", "test");
    expect(toHttpError(err)).toMatchObject({ status: 503, code: "DATABASE_UNAVAILABLE" });
  });

  it.each([
    ["entity.parse.failed", 400, "INVALID_JSON"],
    ["entity.too.large", 413, "PAYLOAD_TOO_LARGE"],
    ["charset.unsupported", 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["encoding.unsupported", 415, "UNSUPPORTED_MEDIA_TYPE"],
  ])("erro do body-parser %s vira %i %s", (type, status, code) => {
    expect(toHttpError(Object.assign(new Error("x"), { type }))).toMatchObject({ status, code });
  });

  it.each([[new Error("boom")], ["texto solto"], [null], [undefined], [{ qualquer: "coisa" }]])("desconhecido %# vira 500 genérico", (err) => {
    expect(toHttpError(err)).toMatchObject({ status: 500, code: "INTERNAL_ERROR", message: "Erro interno" });
  });
});

describe("errorHandler (HTTP)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("responde com o formato compatível: error (texto) + code + requestId", async () => {
    const app = buildApp((r) =>
      r.get("/x", () => {
        throw new UnprocessableError("Dinheiro insuficiente", "INSUFFICIENT_FUNDS");
      }),
    );
    const res = await request(app).get("/x");
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "Dinheiro insuficiente", code: "INSUFFICIENT_FUNDS", requestId: expect.any(String) });
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
  });

  it("500 não vaza a mensagem interna e loga o stack com o requestId", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = buildApp((r) =>
      r.get("/x", () => {
        throw new Error("senha do banco: hunter2");
      }),
    );
    const res = await request(app).get("/x");
    expect(res.status).toBe(500);
    expect(res.text).not.toContain("hunter2");
    expect(res.body).toMatchObject({ error: "Erro interno", code: "INTERNAL_ERROR" });
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0][0])).toContain(res.body.requestId);
  });

  it("4xx não polui o log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = buildApp((r) =>
      r.get("/x", () => {
        throw new NotFoundError();
      }),
    );
    await request(app).get("/x");
    expect(log).not.toHaveBeenCalled();
  });

  it("503 do banco leva o cabeçalho Retry-After", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = buildApp((r) =>
      r.get("/x", () => {
        throw prismaError("P2034");
      }),
    );
    const res = await request(app).get("/x");
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
  });

  it("429 leva o Retry-After do erro", async () => {
    const app = buildApp((r) =>
      r.get("/x", () => {
        throw new TooManyRequestsError(7);
      }),
    );
    const res = await request(app).get("/x");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("7");
  });

  it("rota inexistente responde 404 em JSON", async () => {
    const res = await request(buildApp(() => {})).get("/nao-existe");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toMatchObject({ code: "ROUTE_NOT_FOUND" });
  });

  it("JSON quebrado responde 400 INVALID_JSON (e não 500)", async () => {
    const app = buildApp((r) => r.post("/x", (_req, res) => void res.json({ ok: true })));
    const res = await request(app).post("/x").set("Content-Type", "application/json").send("{quebrado");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "INVALID_JSON" });
  });

  it("corpo grande demais responde 413", async () => {
    const app = buildApp((r) => r.post("/x", (_req, res) => void res.json({ ok: true })));
    const res = await request(app).post("/x").send({ texto: "a".repeat(5000) });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
});
