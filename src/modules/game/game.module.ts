import { Router } from "express";
import { validate } from "../../shared/http/validate";
import { requireAuth } from "../auth/middlewares/require-auth";
import * as controller from "./controllers/game.controller";
import {
  buyAnimalSchema,
  moveBuildingSchema,
  buyBarnSchema,
  buyWellSchema,
  buyMachineSchema,
  buyPlotSchema,
  buySeedSchema,
  enqueueSchema,
  jobParams,
  sellItemSchema,
  startRecipeSchema,
} from "./dto/game.dto";

export const gameModule = Router();

const invalidAction = "Ação inválida";

gameModule.get("/game/catalog", controller.catalog);
gameModule.get("/game/state", requireAuth, controller.state);

gameModule.post("/game/jobs", requireAuth, validate({ body: enqueueSchema, message: invalidAction }), controller.enqueue);
gameModule.delete("/game/jobs", requireAuth, controller.cancelJobs);
gameModule.delete("/game/jobs/:jobId", requireAuth, validate({ params: jobParams, message: "Tarefa inválida" }), controller.cancelJob);
gameModule.post("/game/seeds/buy", requireAuth, validate({ body: buySeedSchema, message: invalidAction }), controller.buySeed);
gameModule.post("/game/items/sell", requireAuth, validate({ body: sellItemSchema, message: invalidAction }), controller.sellItem);
gameModule.post("/game/plots/buy", requireAuth, validate({ body: buyPlotSchema, message: invalidAction }), controller.buyPlot);

gameModule.post("/game/machines/buy", requireAuth, validate({ body: buyMachineSchema, message: invalidAction }), controller.buyMachine);
gameModule.post("/game/machines/start", requireAuth, validate({ body: startRecipeSchema, message: invalidAction }), controller.startRecipe);
gameModule.post("/game/barn/buy", requireAuth, validate({ body: buyBarnSchema, message: invalidAction }), controller.buyBarn);
gameModule.post("/game/barn/expand", requireAuth, controller.expandBarn);
gameModule.post("/game/animals/buy", requireAuth, validate({ body: buyAnimalSchema, message: invalidAction }), controller.buyAnimal);
gameModule.post("/game/animals/feed", requireAuth, controller.feedAnimals);
gameModule.post("/game/well/buy", requireAuth, validate({ body: buyWellSchema, message: invalidAction }), controller.buyWell);
gameModule.post("/game/tools/can/buy", requireAuth, controller.buyCan);
gameModule.post("/game/buildings/move", requireAuth, validate({ body: moveBuildingSchema, message: invalidAction }), controller.moveBuilding);
