import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { clearSessionCookie, readCookie, requireAuth, SESSION_COOKIE, setSessionCookie } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import { AuthError, login, logout, register, requestPasswordReset, resetPassword } from "../services/auth";

export const authRouter = Router();

const email = z.string().trim().toLowerCase().email("E-mail inválido").max(254);
// scrypt trata qualquer tamanho, mas um limite alto evita senhas gigantes para gastar CPU
const password = z.string().min(8, "A senha precisa ter pelo menos 8 caracteres").max(128);

const registerBody = z.object({ email, password, displayName: z.string().trim().min(2, "Nome muito curto").max(30, "Nome muito longo") });
const loginBody = z.object({ email, password: z.string().min(1).max(128) });
const forgotBody = z.object({ email });
const resetBody = z.object({ email, code: z.string().regex(/^\d{6}$/, "O código tem 6 dígitos"), newPassword: password });

// Valida o corpo; se inválido, responde 400 com a primeira mensagem e devolve null
function parse<T>(schema: z.ZodType<T>, req: Request, res: Response): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0]?.message ?? "Dados inválidos" });
    return null;
  }
  return result.data;
}

// Respostas de erro conhecidas viram o status certo; o resto cai no handler 500 do app
function fail(err: unknown, res: Response, next: (err: unknown) => void) {
  if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
  next(err);
}

const MINUTE = 60 * 1000;
const byEmail = (req: Request) => `${req.ip}:${String(req.body?.email ?? "").toLowerCase()}`;

authRouter.post("/auth/register", rateLimit({ windowMs: 60 * MINUTE, max: 10 }), async (req, res, next) => {
  const body = parse(registerBody, req, res);
  if (!body) return;
  try {
    const { user, session } = await register(body, req.get("user-agent"));
    setSessionCookie(res, session.token, session.expiresAt);
    res.status(201).json({ user });
  } catch (err) {
    fail(err, res, next);
  }
});

authRouter.post("/auth/login", rateLimit({ windowMs: 15 * MINUTE, max: 10, key: byEmail }), async (req, res, next) => {
  const body = parse(loginBody, req, res);
  if (!body) return;
  try {
    const { user, session } = await login(body, req.get("user-agent"));
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({ user });
  } catch (err) {
    fail(err, res, next);
  }
});

authRouter.post("/auth/logout", async (req, res, next) => {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await logout(token);
    clearSessionCookie(res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/auth/me", requireAuth, (_req, res) => {
  res.json({ user: res.locals.user });
});

// Sempre 204, exista o e-mail ou não
authRouter.post("/auth/forgot-password", rateLimit({ windowMs: 15 * MINUTE, max: 5 }), async (req, res, next) => {
  const body = parse(forgotBody, req, res);
  if (!body) return;
  try {
    await requestPasswordReset(body.email);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.post("/auth/reset-password", rateLimit({ windowMs: 15 * MINUTE, max: 10, key: byEmail }), async (req, res, next) => {
  const body = parse(resetBody, req, res);
  if (!body) return;
  try {
    await resetPassword(body);
    clearSessionCookie(res);
    res.status(204).end();
  } catch (err) {
    fail(err, res, next);
  }
});
