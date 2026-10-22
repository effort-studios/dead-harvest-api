import { RequestHandler, Router } from "express";
import { z, ZodType } from "zod";
import { requireAuth } from "../middleware/auth";
import { buyPlotSchema, buySeedSchema, plantSchema, sellFruitSchema, tilesSchema } from "../schemas/game";
import * as game from "../services/game";
import { GameError, type GameState } from "../services/game";

export const gameRouter = Router();

// Ação do jogador logado: valida o corpo, aplica no servidor e responde com o estado novo.
// Regra do jogo recusada (sem dinheiro, planta verde...) vira 409 com a mensagem para o jogador.
function action<T>(schema: ZodType<T>, run: (userId: string, input: T, params: Record<string, string>) => Promise<GameState>): RequestHandler {
  return async (req, res, next) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Ação inválida", details: parsed.error.issues });
    try {
      res.json(await run(res.locals.user.id, parsed.data, req.params));
    } catch (err) {
      if (err instanceof GameError) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
}

// Regras do jogo (preços, tempos, árvores): públicas, iguais para todos
gameRouter.get("/game/catalog", async (_req, res, next) => {
  try {
    res.json(await game.getCatalog());
  } catch (err) {
    next(err);
  }
});

gameRouter.get("/game/state", requireAuth, async (_req, res, next) => {
  try {
    const state = await game.getState(res.locals.user.id);
    if (!state) return res.status(404).json({ error: "Save não encontrado" });
    res.json(state);
  } catch (err) {
    next(err);
  }
});

gameRouter.post("/game/till", requireAuth, action(tilesSchema, game.till));
gameRouter.post("/game/plant", requireAuth, action(plantSchema, game.plant));
gameRouter.post("/game/harvest", requireAuth, action(tilesSchema, game.harvest));
gameRouter.post("/game/seeds/buy", requireAuth, action(buySeedSchema, game.buySeed));
gameRouter.post("/game/fruits/sell", requireAuth, action(sellFruitSchema, game.sellFruit));
gameRouter.post("/game/plots/buy", requireAuth, action(buyPlotSchema, game.buyPlot));
gameRouter.post(
  "/game/trees/:treeId/harvest",
  requireAuth,
  action(z.object({}), (userId, _input, params) => game.harvestTree(userId, params.treeId)),
);
