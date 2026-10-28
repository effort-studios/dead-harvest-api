import { asyncHandler } from "../../../shared/http/asyncHandler";
import { currentUser } from "../../auth/middlewares/require-auth";
import type { EnqueueInput, MoveBuildingInput, WalkInput } from "../dto/game.dto";
import * as actions from "../services/game-actions.service";
import * as farmer from "../services/farmer.service";
import * as production from "../services/production.service";
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

export const walk = asyncHandler<Params, WalkInput>(async (req, res) => {
  res.json(await farmer.walk(currentUser(res).id, req.body));
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

export const sellItem = asyncHandler<Params, { itemId: string; quantity?: number }>(async (req, res) => {
  res.json(await actions.sellItem(currentUser(res).id, req.body));
});

export const buyMachine = asyncHandler<Params, { machineId: string; row: number; col: number }>(async (req, res) => {
  res.json(await production.buyMachine(currentUser(res).id, req.body));
});

export const startRecipe = asyncHandler<Params, { recipeId: string }>(async (req, res) => {
  res.json(await production.startRecipe(currentUser(res).id, req.body));
});

export const buyBarn = asyncHandler<Params, { row: number; col: number }>(async (req, res) => {
  res.json(await production.buyBarn(currentUser(res).id, req.body));
});

export const expandBarn = asyncHandler(async (_req, res) => {
  res.json(await production.expandBarn(currentUser(res).id));
});

export const buyAnimal = asyncHandler<Params, { animalId: string }>(async (req, res) => {
  res.json(await production.buyAnimal(currentUser(res).id, req.body));
});

export const feedAnimals = asyncHandler(async (_req, res) => {
  res.json(await production.feedAnimals(currentUser(res).id));
});

export const buyWell = asyncHandler<Params, { row: number; col: number }>(async (req, res) => {
  res.json(await production.buyWell(currentUser(res).id, req.body));
});

export const buyCan = asyncHandler(async (_req, res) => {
  res.json(await actions.buyCan(currentUser(res).id));
});

export const moveBuilding = asyncHandler<Params, MoveBuildingInput>(async (req, res) => {
  res.json(await production.moveBuilding(currentUser(res).id, req.body));
});

export const buyPlot = asyncHandler<Params, { x: number; y: number }>(async (req, res) => {
  res.json(await actions.buyPlot(currentUser(res).id, req.body));
});
