import { asyncHandler } from "../../../shared/http/asyncHandler";
import { currentUser } from "../../auth/middlewares/require-auth";
import type { TilesInput } from "../dto/game.dto";
import * as actions from "../services/game-actions.service";
import { getCatalog } from "../services/catalog.service";
import { getState } from "../services/game-state.service";

type Params = Record<string, string>;

// Regras do jogo (preços, tempos, árvores): públicas, iguais para todos
export const catalog = asyncHandler(async (_req, res) => {
  res.json(await getCatalog());
});

export const state = asyncHandler(async (_req, res) => {
  res.json(await getState(currentUser(res).id));
});

// Toda ação do jogador responde com o estado novo
export const till = asyncHandler<Params, TilesInput>(async (req, res) => {
  res.json(await actions.till(currentUser(res).id, req.body));
});

export const plant = asyncHandler<Params, TilesInput & { cropId: string }>(async (req, res) => {
  res.json(await actions.plant(currentUser(res).id, req.body));
});

export const harvest = asyncHandler<Params, TilesInput>(async (req, res) => {
  res.json(await actions.harvest(currentUser(res).id, req.body));
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

export const harvestTree = asyncHandler(async (req, res) => {
  res.json(await actions.harvestTree(currentUser(res).id, req.params.treeId));
});
