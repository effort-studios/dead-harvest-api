import { asyncHandler } from "../../../shared/http/asyncHandler";
import type { ForgotPasswordInput, LoginInput, RegisterInput, ResendVerificationInput, ResetPasswordInput, VerifyEmailInput } from "../dto/auth.dto";
import { currentUser } from "../middlewares/require-auth";
import * as auth from "../services/auth.service";
import { clearSessionCookie, readCookie, SESSION_COOKIE, setSessionCookie } from "../utils/cookies";

type Params = Record<string, string>;

// Conta criada, mas sem sessão: o jogador ainda precisa confirmar o e-mail com o código (verify-email)
export const register = asyncHandler<Params, RegisterInput>(async (req, res) => {
  const { user } = await auth.register(req.body);
  res.status(201).json({ user, emailVerificationRequired: true });
});

// Código certo: e-mail confirmado e já entra
export const verifyEmail = asyncHandler<Params, VerifyEmailInput>(async (req, res) => {
  const { user, session } = await auth.verifyEmail(req.body, req.get("user-agent"));
  setSessionCookie(res, session.token, session.expiresAt);
  res.json({ user });
});

// Sempre 204, exista o e-mail ou não
export const resendVerification = asyncHandler<Params, ResendVerificationInput>(async (req, res) => {
  await auth.resendEmailVerification(req.body.email);
  res.status(204).end();
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
