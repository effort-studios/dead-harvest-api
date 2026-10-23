import { Router } from "express";
import { validate } from "../../shared/http/validate";
import { requireAuth } from "../auth/middlewares/require-auth";
import * as controller from "./controllers/users.controller";
import { updateProfileBody } from "./dto/users.dto";

export const usersModule = Router();

// A URL fica em /auth/me por compatibilidade com o front (GET /auth/me é do módulo auth)
usersModule.patch("/auth/me", requireAuth, validate({ body: updateProfileBody, message: "Perfil inválido" }), controller.updateProfile);
