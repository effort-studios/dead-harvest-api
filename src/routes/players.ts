import { Router } from "express";
import { createGuestPlayer } from "../services/players";

export const playersRouter = Router();

playersRouter.post("/players", async (_req, res, next) => {
  try {
    const player = await createGuestPlayer();
    res.status(201).json({ id: player.id });
  } catch (err) {
    next(err); // cai no handler de erros do app.ts
  }
});
