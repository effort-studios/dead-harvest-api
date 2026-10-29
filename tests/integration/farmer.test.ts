import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config";
import * as farmer from "../../src/modules/game/services/farmer.service";
import { prisma } from "../../src/shared/database/prisma";
import { as, cleanupTestUsers, createUser } from "../helpers/users";

// A fila do fazendeiro com tempo de verdade: 1 célula por segundo e 1s de gesto. O relógio (só o Date) é
// controlado pelo teste, então "esperar 5 segundos" é só andar o relógio.

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

async function newPlayer(tag: string) {
  const player = await createUser(tag);
  const api = as(player.cookie);
  const till = (...pos: [number, number][]) => api.post("/game/jobs", { action: "till", x: 0, y: 0, tiles: pos.map(([row, col]) => ({ row, col })) });
  const state = async () => (await api.get("/game/state")).body;
  const tilled = async () => prisma.tile.count({ where: { plot: { save: { userId: player.user.id } } } });
  return { ...player, api, till, state, tilled };
}

// O fazendeiro começa em (4, -1.5): o tile (0,0) fica a ~4,3 células (4,3s de caminhada)
describe("fila do fazendeiro com tempo", () => {
  it("anda até o tile, age e só então passa para o próximo (um de cada vez)", async () => {
    const p = await newPlayer("walk");
    const res = await p.till([0, 0], [0, 1]);
    const [first, second] = res.body.farmer.jobs;
    expect(res.body.farmer.jobs).toHaveLength(2);
    expect(first).toMatchObject({ action: "till", row: 0, col: 0, startsAt: T });
    expect(first.arriveAt).toBe(T + 4272); // hypot(4, 1.5) células a 1 célula/s
    expect(first.endsAt).toBe(first.arriveAt + 1000);
    expect(second.startsAt).toBe(first.endsAt); // os horários da fila são encadeados: a tela anima tudo sem esperar
    expect(second.arriveAt).toBe(first.endsAt + 1000); // 1 célula a 1 célula/s
    expect(await p.tilled()).toBe(0);

    at(first.endsAt - T - 1); // ainda no meio do gesto
    expect((await p.state()).farmer.jobs).toHaveLength(2);

    at(first.endsAt - T + 1); // acabou o 1º: o 2º já está andando
    const s1 = await p.state();
    expect(s1.plots[0].grid[0][0].state).toBe("tilled");
    expect(s1.plots[0].grid[0][1].state).toBe("soil");
    expect(s1.farmer).toMatchObject({ row: 0, col: 0 });
    expect(s1.farmer.jobs).toHaveLength(1);
    expect(s1.farmer.jobs[0].startsAt).toBe(first.endsAt);

    at(first.endsAt - T + 2100); // 1s andando + 1s de gesto
    const s2 = await p.state();
    expect(s2.plots[0].grid[0][1].state).toBe("tilled");
    expect(s2.farmer).toMatchObject({ row: 0, col: 1, jobs: [] });
  });

  it("continua com o jogo fechado: só o worker passa o tempo, ninguém lê o estado", async () => {
    const p = await newPlayer("worker");
    await p.till([0, 0], [0, 1], [0, 2]);
    expect(await p.tilled()).toBe(0);

    at(60_000); // o jogador fechou a aba (ou deu F5); nenhuma requisição chegou
    await farmer.tick(p.user.id); // é isto que o worker chama a cada segundo

    expect(await p.tilled()).toBe(3);
    expect(await prisma.farmJob.count({ where: { save: { userId: p.user.id } } })).toBe(0);
  });

  it("depois de um F5 o estado traz a fila e os horários para a tela continuar de onde está", async () => {
    const p = await newPlayer("f5");
    await p.till([0, 0], [0, 1]);
    at(2000);
    const s = await p.state(); // outra "aba": só lê
    expect(s.farmer.jobs).toHaveLength(2);
    expect(s.farmer.jobs[0].startsAt).toBe(T);
    expect(s.serverTime).toBe(T + 2000);
  });

  it("cancelar tudo no meio do caminho: ele para onde está e nada é feito", async () => {
    const p = await newPlayer("cancel-all");
    await p.till([0, 0], [0, 1]);
    at(2150); // metade dos 4,3s de caminhada
    const res = await p.api.delete("/game/jobs");
    expect(res.status).toBe(200);
    expect(res.body.farmer.jobs).toEqual([]);
    expect(res.body.farmer.row).toBeCloseTo(4 - 4 * 0.5, 0); // de (4,-1.5) rumo a (0,0)
    expect(res.body.farmer.col).toBeCloseTo(-1.5 + 1.5 * 0.5, 0);

    at(60_000);
    await farmer.tick(p.user.id);
    expect(await p.tilled()).toBe(0);
  });

  it("cancelar a tarefa em andamento passa para a próxima, a partir de onde ele parou", async () => {
    const p = await newPlayer("cancel-head");
    const queued = await p.till([0, 0], [0, 1]);
    const [first, second] = queued.body.farmer.jobs;
    at(1000);
    const res = await p.api.delete(`/game/jobs/${first.id}`);
    expect(res.status).toBe(200);
    expect(res.body.farmer.jobs).toHaveLength(1);
    expect(res.body.farmer.jobs[0].id).toBe(second.id);
    expect(res.body.farmer.jobs[0].startsAt).toBe(T + 1000); // já está na ativa, sem esperar
  });

  it("cancelar uma tarefa que ainda não começou não mexe nas outras", async () => {
    const p = await newPlayer("cancel-one");
    const queued = await p.till([0, 0], [0, 1], [0, 2]);
    const [a, b, c] = queued.body.farmer.jobs;
    const res = await p.api.delete(`/game/jobs/${b.id}`);
    expect(res.body.farmer.jobs.map((j: { id: string }) => j.id)).toEqual([a.id, c.id]);
    expect(res.body.farmer.jobs[0].startsAt).toBe(a.startsAt);
  });

  it("cancelar tarefa que não existe (ou de outro jogador): 404 JOB_NOT_FOUND", async () => {
    const a = await newPlayer("cancel-a");
    const b = await newPlayer("cancel-b");
    const queued = await a.till([0, 0]);
    const other = await b.api.delete(`/game/jobs/${queued.body.farmer.jobs[0].id}`);
    expect(other.status).toBe(404);
    expect(other.body.code).toBe("JOB_NOT_FOUND");
    expect((await a.state()).farmer.jobs).toHaveLength(1); // a do dono continua
    expect((await a.api.delete("/game/jobs/nao-e-uuid")).status).toBe(400);
  });

  it("ordem: sempre o tile mais perto de onde ele está", async () => {
    const p = await newPlayer("order");
    const res = await p.till([9, 9], [0, 5], [0, 0]);
    expect(res.body.farmer.jobs.map((j: { row: number; col: number }) => [j.row, j.col])).toEqual([
      [0, 0],
      [0, 5],
      [9, 9],
    ]);
  });

  it("a mesma tarefa não entra duas vezes na fila", async () => {
    const p = await newPlayer("dedupe");
    await p.till([0, 0], [0, 1]);
    const res = await p.till([0, 1], [0, 2]);
    expect(res.body.farmer.jobs).toHaveLength(3);
  });

  it("a fila tem limite de 100 tarefas: 422 FARM_QUEUE_FULL", async () => {
    const p = await newPlayer("full");
    for (let row = 0; row < 10; row++) {
      const res = await p.till(...Array.from({ length: 10 }, (_, col) => [row, col] as [number, number]));
      expect(res.status).toBe(200);
    }
    const res = await p.api.post("/game/jobs", { action: "harvest_tree", treeId: (await p.api.get("/game/catalog")).body.trees[0].id });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("FARM_QUEUE_FULL");
  });

  it("árvore: ele anda até a frente dela e colhe quando chega", async () => {
    const p = await newPlayer("tree-walk");
    const tree = (await p.api.get("/game/catalog")).body.trees[0];
    const res = await p.api.post("/game/jobs", { action: "harvest_tree", treeId: tree.id });
    const job = res.body.farmer.jobs[0];
    expect(job).toMatchObject({ action: "harvest_tree", treeId: tree.id, targetRow: tree.row + 1, targetCol: tree.col + 1 });
    expect(res.body.inventory[tree.fruitId]).toBeUndefined();

    at(job.endsAt - T + 1);
    const after = await p.state();
    expect(after.inventory[tree.fruitId]).toBe(tree.fruitsPerHarvest);
    expect(after.farmer.jobs).toEqual([]);
  });

  it("a planta é conferida quando ele chega, não quando o clique foi dado", async () => {
    const p = await newPlayer("ripe-on-arrival");
    const corn = (await p.api.get("/game/catalog")).body.crops.find((c: { id: string }) => c.id === "corn");
    const plot = await prisma.plot.findFirstOrThrow({ where: { save: { userId: p.user.id } } });
    // planta ainda verde (falta 1s depois do pedido, mas ele leva ~4s para chegar)
    await prisma.tile.create({
      data: {
        plotId: plot.id,
        row: 0,
        col: 0,
        state: "planted",
        cropId: "corn",
        plantedAt: new Date(T - (corn.growSeconds - 1) * 1000),
        growthAt: new Date(T - (corn.growSeconds - 1) * 1000),
      },
    });

    const queued = await p.api.post("/game/jobs", { action: "harvest", x: 0, y: 0, tiles: [{ row: 0, col: 0 }] });
    expect(queued.body.inventory[corn.harvestItemId]).toBeUndefined(); // no clique ainda não estava madura

    at(queued.body.farmer.jobs[0].endsAt - T + 1);
    expect((await p.state()).inventory[corn.harvestItemId]).toBe(1); // na chegada, estava
  });

  it("mover: ele só anda até a célula, sem agir, e pedidos para a mesma célula não se repetem", async () => {
    const p = await newPlayer("move");
    const res = await p.api.post("/game/jobs", { action: "move", row: 4, col: 3 });
    expect(res.status).toBe(200);
    const job = res.body.farmer.jobs[0];
    expect(job).toMatchObject({ action: "move", targetRow: 4, targetCol: 3, row: null, col: null });
    expect((await p.api.post("/game/jobs", { action: "move", row: 4, col: 3 })).body.farmer.jobs).toHaveLength(1);
    expect((await p.api.post("/game/jobs", { action: "move", row: 5, col: 3 })).body.farmer.jobs).toHaveLength(2);

    at(job.endsAt - T + 1);
    const after = await p.state();
    expect(after.farmer.jobs).toHaveLength(1); // o 2º pedido já está andando
    expect(after.farmer).toMatchObject({ row: 4, col: 3 });
    expect(await p.tilled()).toBe(0);
  });

  it("mover: célula fora dos limites é recusada (400)", async () => {
    const p = await newPlayer("move-bad");
    expect((await p.api.post("/game/jobs", { action: "move", row: 9999, col: 0 })).status).toBe(400);
  });

  it("desfazer a aragem: o tile arado e vazio volta a ser terra; com planta não", async () => {
    const p = await newPlayer("untill");
    const plot = await prisma.plot.findFirstOrThrow({ where: { save: { userId: p.user.id } } });
    await prisma.tile.create({ data: { plotId: plot.id, row: 0, col: 0, state: "tilled" } });
    await prisma.tile.create({ data: { plotId: plot.id, row: 0, col: 1, state: "planted", cropId: "corn", plantedAt: new Date(T), growthAt: new Date(T) } });
    const job = (row: number, col: number) => p.api.post("/game/jobs", { action: "untill", x: 0, y: 0, tiles: [{ row, col }] });

    const res = await job(0, 0);
    expect(res.body.farmer.jobs[0]).toMatchObject({ action: "untill", row: 0, col: 0 });
    at(res.body.farmer.jobs[0].endsAt - T + 1);
    expect((await p.state()).plots[0].grid[0][0].state).toBe("soil");
    expect(await p.tilled()).toBe(1); // sobrou só o plantado

    const planted = await job(0, 1);
    at(planted.body.farmer.jobs[0].endsAt - T + 1);
    expect((await p.state()).plots[0].grid[0][1].state).toBe("planted"); // recusado: continua plantado
  });
});
