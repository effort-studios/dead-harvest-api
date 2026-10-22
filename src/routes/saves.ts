import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { saveSchema } from "../schemas/save";
import { getSave, InvalidSaveError, updateSave } from "../services/saves";

export const savesRouter = Router();

// O save é sempre o do usuário logado: não existe mais rota por id de jogador
savesRouter.get("/saves/me", requireAuth, async (_req, res, next) => {
  try {
    const save = await getSave(res.locals.user.id);
    if (!save) return res.status(404).json({ error: "Save não encontrado" });
    res.json(save);
  } catch (err) {
    next(err);
  }
});

savesRouter.put("/saves/me", requireAuth, async (req, res, next) => {
  try {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Save inválido", details: parsed.error.issues });
    }
    const save = await updateSave(res.locals.user.id, parsed.data);
    if (!save) return res.status(404).json({ error: "Save não encontrado" });
    res.json(save);
  } catch (err) {
    if (err instanceof InvalidSaveError) return res.status(400).json({ error: err.message });
    next(err);
  }
});
