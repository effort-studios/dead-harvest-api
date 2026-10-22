import { Router } from "express";
import { saveSchema } from "../schemas/save";
import { getSave, updateSave } from "../services/saves";

export const savesRouter = Router();

// Só devolve os campos do jogo (sem ids internos)
function toResponse(s: { day: number; time: number; money: number; plots: unknown; inventory: unknown; trees: unknown; updatedAt: Date }) {
  return { day: s.day, time: s.time, money: s.money, plots: s.plots, inventory: s.inventory, trees: s.trees, updatedAt: s.updatedAt };
}

savesRouter.get("/saves/:playerId", async (req, res, next) => {
  try {
    const save = await getSave(req.params.playerId);
    if (!save) return res.status(404).json({ error: "Save não encontrado" });
    res.json(toResponse(save));
  } catch (err) {
    next(err);
  }
});

savesRouter.put("/saves/:playerId", async (req, res, next) => {
  try {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Save inválido", details: parsed.error.issues });
    }
    const save = await updateSave(req.params.playerId, parsed.data);
    if (!save) return res.status(404).json({ error: "Jogador não encontrado" });
    res.json(toResponse(save));
  } catch (err) {
    next(err);
  }
});
