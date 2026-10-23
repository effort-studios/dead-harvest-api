import { Router } from "express";
import { validate } from "../../shared/http/validate";
import { requireAuth } from "../auth/auth.middleware";
import * as controller from "./game.controller";
import { buyPlotSchema, buySeedSchema, plantSchema, sellFruitSchema, tilesSchema, treeParams } from "./game.schemas";

export const gameRouter = Router();

const invalidAction = "Ação inválida";

gameRouter.get("/game/catalog", controller.catalog);
gameRouter.get("/game/state", requireAuth, controller.state);

gameRouter.post("/game/till", requireAuth, validate({ body: tilesSchema, message: invalidAction }), controller.till);
gameRouter.post("/game/plant", requireAuth, validate({ body: plantSchema, message: invalidAction }), controller.plant);
gameRouter.post("/game/harvest", requireAuth, validate({ body: tilesSchema, message: invalidAction }), controller.harvest);
gameRouter.post("/game/seeds/buy", requireAuth, validate({ body: buySeedSchema, message: invalidAction }), controller.buySeed);
gameRouter.post("/game/fruits/sell", requireAuth, validate({ body: sellFruitSchema, message: invalidAction }), controller.sellFruit);
gameRouter.post("/game/plots/buy", requireAuth, validate({ body: buyPlotSchema, message: invalidAction }), controller.buyPlot);
gameRouter.post("/game/trees/:treeId/harvest", requireAuth, validate({ params: treeParams, message: "Árvore inválida" }), controller.harvestTree);
