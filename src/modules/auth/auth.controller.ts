import { asyncHandler } from "../../shared/http/asyncHandler";
import { clearSessionCookie, readCookie, SESSION_COOKIE, setSessionCookie } from "./auth.cookies";
import { currentUser } from "./auth.middleware";
import type { ForgotPasswordInput, LoginInput, RegisterInput, ResetPasswordInput } from "./auth.schemas";
import * as auth from "./auth.service";

type Params = Record<string, string>;

export const register = asyncHandler<Params, RegisterInput>(async (req, res) => {
  const { user, session } = await auth.register(req.body, req.get("user-agent"));
  setSessionCookie(res, session.token, session.expiresAt);
  res.status(201).json({ user });
});

export const login = asyncHandler<Params, LoginInput>(async (req, res) => {
  const { user, session } = await auth.login(req.body, req.get("user-agent"));
  setSessionCookie(res, session.token, session.expiresAt);
  res.json({ user });
});

export const logout = asyncHandler(async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await auth.logout(token);
  clearSessionCookie(res);
  res.status(204).end();
});

export const me = asyncHandler(async (_req, res) => {
  res.json({ user: currentUser(res) });
});

// Sempre 204, exista o e-mail ou não
export const forgotPassword = asyncHandler<Params, ForgotPasswordInput>(async (req, res) => {
  await auth.requestPasswordReset(req.body.email);
  res.status(204).end();
});

export const resetPassword = asyncHandler<Params, ResetPasswordInput>(async (req, res) => {
  await auth.resetPassword(req.body);
  clearSessionCookie(res);
  res.status(204).end();
});
