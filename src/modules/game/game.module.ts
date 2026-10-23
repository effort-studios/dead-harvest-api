import { Router } from "express";
import { validate } from "../../shared/http/validate";
import { requireAuth } from "../auth/middlewares/require-auth";
import * as controller from "./controllers/game.controller";
import { buyPlotSchema, buySeedSchema, enqueueSchema, jobParams, sellFruitSchema } from "./dto/game.dto";

export const gameModule = Router();

const invalidAction = "Ação inválida";

gameModule.get("/game/catalog", controller.catalog);
gameModule.get("/game/state", requireAuth, controller.state);

gameModule.post("/game/jobs", requireAuth, validate({ body: enqueueSchema, message: invalidAction }), controller.enqueue);
gameModule.delete("/game/jobs", requireAuth, controller.cancelJobs);
gameModule.delete("/game/jobs/:jobId", requireAuth, validate({ params: jobParams, message: "Tarefa inválida" }), controller.cancelJob);
gameModule.post("/game/seeds/buy", requireAuth, validate({ body: buySeedSchema, message: invalidAction }), controller.buySeed);
gameModule.post("/game/fruits/sell", requireAuth, validate({ body: sellFruitSchema, message: invalidAction }), controller.sellFruit);
gameModule.post("/game/plots/buy", requireAuth, validate({ body: buyPlotSchema, message: invalidAction }), controller.buyPlot);
