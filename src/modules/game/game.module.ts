import { Router } from "express";
import { validate } from "../../shared/http/validate";
import { requireAuth } from "../auth/middlewares/require-auth";
import * as controller from "./controllers/game.controller";
import { buyPlotSchema, buySeedSchema, plantSchema, sellFruitSchema, tilesSchema, treeParams } from "./dto/game.dto";

export const gameModule = Router();

const invalidAction = "Ação inválida";

gameModule.get("/game/catalog", controller.catalog);
gameModule.get("/game/state", requireAuth, controller.state);

gameModule.post("/game/till", requireAuth, validate({ body: tilesSchema, message: invalidAction }), controller.till);
gameModule.post("/game/plant", requireAuth, validate({ body: plantSchema, message: invalidAction }), controller.plant);
gameModule.post("/game/harvest", requireAuth, validate({ body: tilesSchema, message: invalidAction }), controller.harvest);
gameModule.post("/game/seeds/buy", requireAuth, validate({ body: buySeedSchema, message: invalidAction }), controller.buySeed);
gameModule.post("/game/fruits/sell", requireAuth, validate({ body: sellFruitSchema, message: invalidAction }), controller.sellFruit);
gameModule.post("/game/plots/buy", requireAuth, validate({ body: buyPlotSchema, message: invalidAction }), controller.buyPlot);
gameModule.post("/game/trees/:treeId/harvest", requireAuth, validate({ params: treeParams, message: "Árvore inválida" }), controller.harvestTree);
