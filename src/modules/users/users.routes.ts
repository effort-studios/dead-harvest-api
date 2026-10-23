import { Router } from "express";
import { validate } from "../../shared/http/validate";
import { requireAuth } from "../auth/auth.middleware";
import * as controller from "./users.controller";
import { updateProfileBody } from "./users.schemas";

export const usersRouter = Router();

// A URL fica em /auth/me por compatibilidade com o front (GET /auth/me é do módulo auth)
usersRouter.patch("/auth/me", requireAuth, validate({ body: updateProfileBody, message: "Perfil inválido" }), controller.updateProfile);
