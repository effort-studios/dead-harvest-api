import type { NextFunction, Request, RequestHandler, Response } from "express";
import { config } from "../config";
import { userFromSession, type PublicUser } from "../services/auth";

export const SESSION_COOKIE = "dh_session";

// Lê um cookie do cabeçalho (o app não precisa de uma biblioteca só para isso)
export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

// httpOnly: o JavaScript da página não lê o cookie (um XSS não rouba a sessão).
// SameSite=Lax: o navegador não manda o cookie em requisições vindas de outros sites.
export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: config.isProduction, expires: expiresAt, path: "/" });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: config.isProduction, path: "/" });
}

// Rotas protegidas: sem sessão válida, 401. O usuário fica em res.locals.user.
export const requireAuth: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    const user = token ? await userFromSession(token) : null;
    if (!user) return res.status(401).json({ error: "Não autenticado" });
    res.locals.user = user satisfies PublicUser;
    next();
  } catch (err) {
    next(err);
  }
};
