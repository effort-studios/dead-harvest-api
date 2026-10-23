import type { Request, Response } from "express";
import { config } from "../../config";

export const SESSION_COOKIE = "dh_session";

// Lê um cookie do cabeçalho (o app não precisa de uma biblioteca só para isso)
export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return undefined; // cookie com escape inválido (%zz): trata como se não existisse, em vez de dar 500
    }
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
