import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config";
import { prisma } from "../../src/shared/database/prisma";
import { as, cleanupTestUsers, createUser } from "../helpers/users";

// Andar livre (WASD): o cliente avisa a posição e o servidor limita pela velocidade. Relógio controlado
// pelo teste; 1 célula por segundo.

const originalSpeed = config.farmerWalkSpeed;
const originalAct = config.farmerActMs;
let T: number;
const at = (ms: number) => vi.setSystemTime(T + ms);

beforeAll(cleanupTestUsers);
afterAll(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
});
beforeEach(() => {
  config.farmerWalkSpeed = 1;
  config.farmerActMs = 1000;
  T = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T);
});
afterEach(() => {
  vi.useRealTimers();
  config.farmerWalkSpeed = originalSpeed;
  config.farmerActMs = originalAct;
});

// O fazendeiro começa em (4, -1.5)
async function newPlayer(tag: string) {
  const player = await createUser(tag);
  const api = as(player.cookie);
  const walk = (row: number, col: number) => api.post("/game/farmer/position", { row, col });
  return { ...player, api, walk };
}

describe("andar livre", () => {
  it("aceita a posição avisada e deixa o fazendeiro parado ali, sem fila", async () => {
    const p = await newPlayer("walk-ok");
    await p.walk(4, -1.5); // 1º aviso marca o horário
    at(1000);
    const res = await p.walk(4, -0.8); // 0,7 célula em 1s, dentro do limite
    expect(res.status).toBe(200);
    expect(res.body.farmer).toMatchObject({ row: 4, col: -0.8, jobs: [] });
    expect((await p.api.get("/game/state")).body.farmer).toMatchObject({ row: 4, col: -0.8, jobs: [] });
  });

  it("limita a posição pela velocidade: não dá para teleportar", async () => {
    const p = await newPlayer("walk-fast");
    await p.walk(4, -1.5);
    at(1000);
    const res = await p.walk(4, 50); // 51,5 células em 1s
    const { row, col } = res.body.farmer;
    expect(row).toBe(4);
    expect(col).toBeGreaterThan(-1.5);
    expect(col).toBeLessThan(0.5); // 1 célula/s x 1,25 + 0,5 de folga a partir de -1,5
  });

  it("depois de muito tempo parado, o crédito de caminhada é limitado", async () => {
    const p = await newPlayer("walk-idle");
    await p.walk(4, -1.5);
    at(60 * 60 * 1000); // 1 hora depois
    const res = await p.walk(4, 80);
    expect(res.body.farmer.col).toBeLessThan(3); // no máximo 3s de caminhada, não a hora inteira
  });

  it("ignora o aviso enquanto há fila de tarefas (a fila manda)", async () => {
    const p = await newPlayer("walk-busy");
    const queued = await p.api.post("/game/jobs", { action: "move", row: 10, col: 10 });
    expect(queued.body.farmer.jobs).toHaveLength(1);
    const res = await p.walk(0, 0);
    expect(res.status).toBe(200);
    expect(res.body.farmer.jobs).toHaveLength(1);
    expect(res.body.farmer.row).toBe(4);
  });

  it("recusa posição fora do mapa", async () => {
    const p = await newPlayer("walk-bounds");
    expect((await p.walk(500, 0)).status).toBe(400);
  });

  it("exige login", async () => {
    const res = await as("").post("/game/farmer/position", { row: 0, col: 0 });
    expect(res.status).toBe(401);
  });

  it("uma tarefa enfileirada depois de andar parte de onde ele parou", async () => {
    const p = await newPlayer("walk-then-job");
    await p.walk(4, -1.5);
    at(1000);
    await p.walk(4, -0.8);
    const res = await p.api.post("/game/jobs", { action: "move", row: 4, col: 1 });
    const [job] = res.body.farmer.jobs;
    expect(job.arriveAt - job.startsAt).toBe(1800); // 1,8 célula a partir de (4, -0.8)
  });
});
