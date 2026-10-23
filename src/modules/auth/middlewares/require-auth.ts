import type { RequestHandler, Response } from "express";
import { UnauthorizedError } from "../../../shared/errors/AppError";
import type { PublicUser } from "../../users/entities/public-user";
import { userFromSession } from "../services/auth.service";
import { clearSessionCookie, readCookie, SESSION_COOKIE } from "../utils/cookies";

// Rotas protegidas: sem sessão válida, 401. O usuário fica em res.locals.user (leia com currentUser).
export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    const user = token ? await userFromSession(token) : null;
    if (!user) {
      if (token) clearSessionCookie(res); // cookie de sessão expirada/revogada: o navegador para de mandar
      throw new UnauthorizedError();
    }
    res.locals.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

// Usuário logado da requisição; só vale depois do requireAuth
export const currentUser = (res: Response): PublicUser => res.locals.user;
