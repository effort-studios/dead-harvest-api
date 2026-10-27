import { AppError, BadRequestError, NotFoundError, UnprocessableError } from "../../../shared/errors/AppError";
import type { EnqueueInput } from "../dto/game.dto";
import type { GameState } from "../entities/game-state";
import * as repo from "../repositories/game.repository";
import { distance, positionAt, schedule, type Cell } from "../utils/farmer-timeline";
import { GRID_SIZE, MAX_FARM_JOBS } from "../utils/game.constants";
import { barnCollectTarget, machineCollectTarget, wellTarget } from "../utils/layout";
import * as actions from "./game-actions.service";
import { loadState } from "./game-state.service";
import * as production from "./production.service";

// O fazendeiro e a fila dele. O cliente só enfileira e cancela; quem anda, espera e executa cada ação
// (uma de cada vez, na ordem) é o servidor. O worker (worker/farmer.worker.ts) passa por aqui a cada
// segundo, então a fila anda com o front fechado; ler o estado também a põe em dia.

const cellOf = (save: { farmerRow: number; farmerCol: number }): Cell => ({ row: save.farmerRow, col: save.farmerCol });
const targetOf = (job: { targetRow: number; targetCol: number }): Cell => ({ row: job.targetRow, col: job.targetCol });

// Trava o save, põe a fila em dia, roda `work` e devolve o estado novo (tudo numa transação)
function withFarmer(userId: string, work: (tx: repo.Tx, save: repo.LockedSave, now: number) => Promise<void>): Promise<GameState> {
  return repo.transaction(async (tx) => {
    const now = Date.now();
    const locked = await repo.lockSave(tx, userId);
    if (!locked) throw new NotFoundError("Save não encontrado", "SAVE_NOT_FOUND");
    const save = await advance(tx, locked, now);
    await work(tx, save, now);
    return loadState(tx, userId, now);
  });
}

// Executa tudo o que já deu tempo de acontecer até `now`. Cada ação roda no instante em que o gesto
// termina (a planta madura ou não, a árvore pronta ou não, é conferido nesse instante). Ação que a regra
// do jogo recusa (planta ainda verde, sem semente...) é descartada, mas o tempo gasto andando não volta.
// Devolve o save com a posição do fazendeiro atualizada.
async function advance(tx: repo.Tx, save: repo.LockedSave, now: number): Promise<repo.LockedSave> {
  const jobs = await repo.findJobs(tx, save.id);
  if (jobs.length === 0) return save;

  let at = cellOf(save);
  let startsAt = save.farmerFreeAt?.getTime() ?? now;
  const done: string[] = [];
  for (const job of jobs) {
    const to = targetOf(job);
    const s = schedule(at, to, startsAt);
    if (s.endsAt > now) break;
    try {
      await run(tx, save, job, s.endsAt);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
    }
    done.push(job.id);
    at = to;
    startsAt = s.endsAt;
  }
  if (done.length === 0) return save;

  await repo.deleteJobs(tx, save.id, done);
  const freeAt = done.length < jobs.length ? new Date(startsAt) : null;
  await repo.setFarmer(tx, save.id, { ...at, freeAt });
  return { ...save, farmerRow: at.row, farmerCol: at.col, farmerFreeAt: freeAt };
}

// Roda o pedido como se fosse a ação do jogador, no instante `now`
function run(tx: repo.Tx, save: repo.LockedSave, job: repo.FarmJobRow, now: number) {
  const tile = { x: job.plotX!, y: job.plotY!, tiles: [{ row: job.row!, col: job.col! }] };
  const action =
    job.action === "till" ? actions.tillAction(tile)
    : job.action === "plant" ? actions.plantAction({ ...tile, cropId: job.cropId! })
    : job.action === "harvest" ? actions.harvestAction(tile)
    : job.action === "fertilize" ? actions.fertilizeAction(tile)
    : job.action === "water" ? actions.waterAction(tile)
    : job.action === "refill_can" ? production.refillCanAction()
    : job.action === "collect_machine" ? production.collectMachineAction(job.machineId!)
    : job.action === "collect_barn" ? production.collectBarnAction()
    : actions.harvestTreeAction(job.treeId!);
  return action(tx, save, now);
}

// ---------- Rotas ----------

// Estado do jogo com a fila em dia (é o que GET /game/state devolve)
export const refresh = (userId: string) => withFarmer(userId, async () => {});

type JobKeyed = { action: string; plotX: number | null; plotY: number | null; row: number | null; col: number | null; treeId: string | null; machineId: string | null };
const keyOf = (j: JobKeyed) => `${j.action}|${j.treeId ?? j.machineId ?? `${j.plotX},${j.plotY},${j.row},${j.col}`}`;

// Vira pedidos na fila: um por tile, do mais perto para o mais longe de onde o fazendeiro vai estar
export const enqueue = (userId: string, input: EnqueueInput) =>
  withFarmer(userId, async (tx, save, now) => {
    const pending = await repo.findJobs(tx, save.id);
    const candidates = await toJobs(tx, save, input);

    // o mesmo tile/árvore não entra duas vezes na fila (cliques repetidos)
    const queued = new Set(pending.map(keyOf));
    const fresh = candidates.filter((j) => !queued.has(keyOf(j)));
    if (fresh.length === 0) return;
    if (pending.length + fresh.length > MAX_FARM_JOBS) {
      throw new UnprocessableError(`A fila do fazendeiro aguenta no máximo ${MAX_FARM_JOBS} tarefas`, "FARM_QUEUE_FULL");
    }

    const from = pending.length > 0 ? targetOf(pending[pending.length - 1]) : cellOf(save);
    await repo.createJobs(tx, save.id, nearestFirst(from, fresh));
    // fila vazia: o primeiro pedido começa agora
    const freeAt = pending.length === 0 ? new Date(now) : save.farmerFreeAt;
    if (pending.length === 0) await repo.setFarmer(tx, save.id, { row: save.farmerRow, col: save.farmerCol, freeAt });
    await advance(tx, { ...save, farmerFreeAt: freeAt }, now) // tempos zerados (testes): já executa
  });

// Cancela a fila toda ou um pedido só. Se o pedido em andamento é cancelado, o fazendeiro para onde está.
export const cancel = (userId: string, jobId?: string) =>
  withFarmer(userId, async (tx, save, now) => {
    const jobs = await repo.findJobs(tx, save.id);
    if (jobId && !jobs.some((j) => j.id === jobId)) throw new NotFoundError("Tarefa não encontrada", "JOB_NOT_FOUND");
    const head = jobs[0];
    if (!head) return;
    // um pedido que ainda não começou sai sem mexer no resto: os horários seguintes se ajustam sozinhos
    if (jobId && head.id !== jobId) {
      await repo.deleteJobs(tx, save.id, [jobId]);
      return;
    }
    const from = cellOf(save);
    const to = targetOf(head);
    const where = positionAt(from, to, schedule(from, to, save.farmerFreeAt?.getTime() ?? now), now);
    const remaining = jobId ? jobs.length - 1 : 0;
    await repo.deleteJobs(tx, save.id, jobId ? [jobId] : undefined);
    await repo.setFarmer(tx, save.id, { ...where, freeAt: remaining > 0 ? new Date(now) : null });
  });

// Põe em dia a fila de um jogador (chamado pelo worker)
export const tick = async (userId: string) => {
  await refresh(userId);
};

// ---------- Montagem dos pedidos ----------

const NO_TILE = { plotX: null, plotY: null, row: null, col: null, cropId: null, treeId: null, machineId: null };

async function toJobs(tx: repo.Tx, save: repo.LockedSave, input: EnqueueInput): Promise<repo.NewFarmJob[]> {
  const saveId = save.id;
  if (input.action === "harvest_tree") {
    const tree = await repo.findTree(tx, input.treeId);
    if (!tree) throw new NotFoundError("Árvore não encontrada", "TREE_NOT_FOUND");
    // ele para na frente da árvore (uma célula adiante em linha e coluna), não em cima do tronco
    return [{ ...NO_TILE, action: "harvest_tree", treeId: tree.id, targetRow: tree.row + 1, targetCol: tree.col + 1 }];
  }
  if (input.action === "collect_machine") {
    const owned = await production.requireOwnedMachine(tx, saveId, input.machineId);
    // como na árvore: para na frente da máquina, onde o jogador a deixou
    const target = machineCollectTarget(owned, owned.size);
    return [{ ...NO_TILE, action: "collect_machine", machineId: owned.machineId, targetRow: target.row, targetCol: target.col }];
  }
  if (input.action === "refill_can") {
    const target = wellTarget(production.requireCanRefill(save));
    return [{ ...NO_TILE, action: "refill_can", targetRow: target.row, targetCol: target.col }];
  }
  if (input.action === "collect_barn") {
    if (save.barnRow === null || save.barnCol === null) throw new UnprocessableError("Compre o celeiro antes", "NO_BARN");
    const target = barnCollectTarget({ row: save.barnRow, col: save.barnCol });
    return [{ ...NO_TILE, action: "collect_barn", targetRow: target.row, targetCol: target.col }];
  }
  const plot = await repo.findPlot(tx, saveId, input.x, input.y);
  if (!plot) throw new NotFoundError("Terreno não encontrado", "PLOT_NOT_FOUND");
  let cropId: string | null = null;
  if (input.action === "plant") {
    const crop = await repo.findCrop(tx, input.cropId);
    if (!crop) throw new BadRequestError("Planta desconhecida", "UNKNOWN_CROP");
    cropId = crop.id;
  }
  return input.tiles.map((t) => ({
    action: input.action,
    plotX: input.x,
    plotY: input.y,
    row: t.row,
    col: t.col,
    cropId,
    treeId: null,
    machineId: null,
    targetRow: input.y * GRID_SIZE + t.row,
    targetCol: input.x * GRID_SIZE + t.col,
  }));
}

// Ordem de trabalho: sempre o mais perto de onde ele está (vizinho mais próximo)
function nearestFirst(start: Cell, jobs: repo.NewFarmJob[]): repo.NewFarmJob[] {
  const left = [...jobs];
  const ordered: repo.NewFarmJob[] = [];
  let at = start;
  while (left.length > 0) {
    let best = 0;
    for (let i = 1; i < left.length; i++) {
      if (distance(at, targetOf(left[i])) < distance(at, targetOf(left[best]))) best = i;
    }
    const [next] = left.splice(best, 1);
    ordered.push(next);
    at = targetOf(next);
  }
  return ordered;
}
