import { Router, type Request } from "express";
import { rateLimit } from "../../shared/http/rateLimit";
import { validate } from "../../shared/http/validate";
import * as controller from "./auth.controller";
import { requireAuth } from "./auth.middleware";
import { forgotPasswordBody, loginBody, registerBody, resetPasswordBody } from "./auth.schemas";

export const authRouter = Router();

const MINUTE = 60 * 1000;
const byEmail = (req: Request) => `${req.ip}:${String(req.body?.email ?? "").toLowerCase()}`;

authRouter.post("/auth/register", rateLimit({ windowMs: 60 * MINUTE, max: 10 }), validate({ body: registerBody }), controller.register);
authRouter.post("/auth/login", rateLimit({ windowMs: 15 * MINUTE, max: 10, key: byEmail }), validate({ body: loginBody }), controller.login);
authRouter.post("/auth/logout", controller.logout);
authRouter.get("/auth/me", requireAuth, controller.me);
// Sempre 204, exista o e-mail ou não
authRouter.post("/auth/forgot-password", rateLimit({ windowMs: 15 * MINUTE, max: 5 }), validate({ body: forgotPasswordBody }), controller.forgotPassword);
authRouter.post(
  "/auth/reset-password",
  rateLimit({ windowMs: 15 * MINUTE, max: 10, key: byEmail }),
  validate({ body: resetPasswordBody }),
  controller.resetPassword,
);
