import { asyncHandler } from "../../../shared/http/asyncHandler";
import { currentUser } from "../../auth/middlewares/require-auth";
import type { EnqueueInput } from "../dto/game.dto";
import * as actions from "../services/game-actions.service";
import * as farmer from "../services/farmer.service";
import { getCatalog } from "../services/catalog.service";

type Params = Record<string, string>;

// Regras do jogo (preços, tempos, árvores): públicas, iguais para todos
export const catalog = asyncHandler(async (_req, res) => {
  res.json(await getCatalog());
});

export const state = asyncHandler(async (_req, res) => {
  res.json(await farmer.refresh(currentUser(res).id));
});

// Toda ação do jogador responde com o estado novo
// Arar, plantar e colher não são ações imediatas: viram tarefas do fazendeiro, que o servidor executa uma de cada vez
export const enqueue = asyncHandler<Params, EnqueueInput>(async (req, res) => {
  res.json(await farmer.enqueue(currentUser(res).id, req.body));
});

export const cancelJobs = asyncHandler(async (_req, res) => {
  res.json(await farmer.cancel(currentUser(res).id));
});

export const cancelJob = asyncHandler(async (req, res) => {
  res.json(await farmer.cancel(currentUser(res).id, req.params.jobId));
});

export const buySeed = asyncHandler<Params, { cropId: string; quantity: number }>(async (req, res) => {
  res.json(await actions.buySeed(currentUser(res).id, req.body));
});

export const sellFruit = asyncHandler<Params, { itemId: string; quantity?: number }>(async (req, res) => {
  res.json(await actions.sellFruit(currentUser(res).id, req.body));
});

export const buyPlot = asyncHandler<Params, { x: number; y: number }>(async (req, res) => {
  res.json(await actions.buyPlot(currentUser(res).id, req.body));
});
