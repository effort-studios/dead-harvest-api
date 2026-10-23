import { Router, type Request } from "express";
import { rateLimit } from "../../shared/http/rateLimit";
import { validate } from "../../shared/http/validate";
import * as controller from "./controllers/auth.controller";
import { forgotPasswordBody, loginBody, registerBody, resetPasswordBody } from "./dto/auth.dto";
import { requireAuth } from "./middlewares/require-auth";

export const authModule = Router();

const MINUTE = 60 * 1000;
const byEmail = (req: Request) => `${req.ip}:${String(req.body?.email ?? "").toLowerCase()}`;

authModule.post("/auth/register", rateLimit({ windowMs: 60 * MINUTE, max: 10 }), validate({ body: registerBody }), controller.register);
authModule.post("/auth/login", rateLimit({ windowMs: 15 * MINUTE, max: 10, key: byEmail }), validate({ body: loginBody }), controller.login);
authModule.post("/auth/logout", controller.logout);
authModule.get("/auth/me", requireAuth, controller.me);
// Sempre 204, exista o e-mail ou não
authModule.post("/auth/forgot-password", rateLimit({ windowMs: 15 * MINUTE, max: 5 }), validate({ body: forgotPasswordBody }), controller.forgotPassword);
authModule.post(
  "/auth/reset-password",
  rateLimit({ windowMs: 15 * MINUTE, max: 10, key: byEmail }),
  validate({ body: resetPasswordBody }),
  controller.resetPassword,
);
