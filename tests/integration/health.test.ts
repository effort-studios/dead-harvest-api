import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { prisma } from "../../src/shared/database/prisma";

describe("ambiente de integração", () => {
  it("GET /health responde ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("usa o banco de teste (nunca o de desenvolvimento), já migrado e com o catálogo", async () => {
    const [{ current_database }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
    expect(current_database).toMatch(/_test$/);
    expect(await prisma.crop.count()).toBeGreaterThan(0);
    expect(await prisma.tree.count()).toBeGreaterThan(0);
  });
});
