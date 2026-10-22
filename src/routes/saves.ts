import { Router } from "express";
import { z } from "zod";
import { saveSchema } from "../schemas/save";
import { getSave, InvalidSaveError, updateSave } from "../services/saves";

export const savesRouter = Router();

// O id vira uuid no banco; um id que não é uuid não pode existir (evita erro 500 do banco)
const isId = (id: string) => z.string().uuid().safeParse(id).success;

savesRouter.get("/saves/:playerId", async (req, res, next) => {
  try {
    if (!isId(req.params.playerId)) return res.status(404).json({ error: "Save não encontrado" });
    const save = await getSave(req.params.playerId);
    if (!save) return res.status(404).json({ error: "Save não encontrado" });
    res.json(save);
  } catch (err) {
    next(err);
  }
});

savesRouter.put("/saves/:playerId", async (req, res, next) => {
  try {
    if (!isId(req.params.playerId)) return res.status(404).json({ error: "Jogador não encontrado" });
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Save inválido", details: parsed.error.issues });
    }
    const save = await updateSave(req.params.playerId, parsed.data);
    if (!save) return res.status(404).json({ error: "Jogador não encontrado" });
    res.json(save);
  } catch (err) {
    if (err instanceof InvalidSaveError) return res.status(400).json({ error: err.message });
    next(err);
  }
});
