import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../../../config";
import { isPrismaError } from "../../../shared/database/prisma-errors";
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from "../../../shared/errors/AppError";
import { initialSave } from "../../game/utils/initial-save";
import { toPublicUser, type PublicUser } from "../../users/entities/public-user";
import * as userRepository from "../../users/repositories/user.repository";
import type { LoginInput, RegisterInput, ResetPasswordInput, VerifyEmailInput } from "../dto/auth.dto";
import type { AuthSession } from "../entities/auth-session";
import * as emailVerifications from "../repositories/email-verification.repository";
import * as passwordResets from "../repositories/password-reset.repository";
import * as sessions from "../repositories/session.repository";
import { sendEmailVerificationCode, sendPasswordResetCode } from "../utils/mailer";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../utils/password";
import { hmac, sha256 } from "../utils/tokens";

// ---------- Sessão ----------

// O token (aleatório, 256 bits) vai só para o cookie do navegador; no banco fica o hash dele
async function createSession(userId: string, userAgent: string | undefined): Promise<AuthSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
  await sessions.create({ userId, tokenHash: sha256(token), expiresAt, userAgent: userAgent?.slice(0, 300) });
  return { token, expiresAt };
}

export async function userFromSession(token: string): Promise<PublicUser | null> {
  const session = await sessions.findByTokenHash(sha256(token));
  if (!session || session.expiresAt <= new Date()) return null;
  return toPublicUser(session.user);
}

export async function logout(token: string) {
  await sessions.deleteByTokenHash(sha256(token));
}

// ---------- Cadastro e login ----------

// Cria a conta SEM sessão: só entra depois de confirmar o e-mail com o código enviado (verifyEmail)
export async function register(input: RegisterInput) {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await userRepository.createWithSave({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
      save: initialSave(),
    });
    // A conta já existe; se o envio falhar, o jogador pede outro código (resend-verification) em vez de levar um 500
    await sendVerificationCode(user).catch((err) => console.error("[auth] falha ao enviar o código de confirmação:", err));
    return { user: toPublicUser(user) };
  } catch (err) {
    if (isPrismaError(err, "P2002")) throw new ConflictError("Já existe uma conta com este e-mail", "EMAIL_TAKEN");
    throw err;
  }
}

export async function login(input: LoginInput, userAgent?: string) {
  const user = await userRepository.findByEmail(input.email);
  // Mesmo sem usuário, gasta o tempo de verificar uma senha: a resposta não revela se o e-mail existe
  const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new UnauthorizedError("E-mail ou senha inválidos", "INVALID_CREDENTIALS");
  // Só diz isso a quem acertou a senha: não revela quais e-mails têm conta
  if (!user.emailVerifiedAt) throw new ForbiddenError("Confirme seu e-mail para entrar", "EMAIL_NOT_VERIFIED");
  await userRepository.touchLastLogin(user.id);
  return { user: toPublicUser(user), session: await createSession(user.id, userAgent) };
}

// ---------- Códigos de 6 dígitos (confirmação de e-mail e recuperação de senha) ----------

const CODE_COOLDOWN_MS = 60 * 1000; // no máximo 1 código por minuto por usuário

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
const codeExpiry = () => new Date(Date.now() + config.resetCodeMinutes * 60 * 1000);

function codeMatches(codeHash: string, userId: string, code: string) {
  const expected = Buffer.from(codeHash);
  const actual = Buffer.from(hmac(`${userId}:${code}`));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---------- Confirmação de e-mail ----------

async function sendVerificationCode(user: { id: string; email: string }) {
  const code = newCode();
  await emailVerifications.replaceCode(user.id, hmac(`${user.id}:${code}`), codeExpiry());
  await sendEmailVerificationCode(user.email, code);
}

// Sempre termina sem erro, exista o e-mail ou não (e esteja a conta confirmada ou não): quem pergunta não descobre nada
export async function resendEmailVerification(email: string) {
  const user = await userRepository.findByEmail(email);
  if (!user || user.emailVerifiedAt) return;

  const last = await emailVerifications.findLatest(user.id);
  if (last && Date.now() - last.createdAt.getTime() < CODE_COOLDOWN_MS) return;

  await sendVerificationCode(user);
}

// Mesma resposta para e-mail inexistente, já confirmado, código errado, vencido ou esgotado
const invalidVerificationCode = () => new BadRequestError("Código inválido ou expirado", "INVALID_VERIFICATION_CODE");

// Código certo: confirma o e-mail e já entra (cria a sessão)
export async function verifyEmail(input: VerifyEmailInput, userAgent?: string) {
  const user = await userRepository.findByEmail(input.email);
  if (!user || user.emailVerifiedAt) throw invalidVerificationCode();

  const verification = await emailVerifications.findUsable(user.id, config.resetMaxAttempts);
  if (!verification) throw invalidVerificationCode();

  if (!codeMatches(verification.codeHash, user.id, input.code)) {
    await emailVerifications.incrementAttempts(verification.id);
    throw invalidVerificationCode();
  }

  await emailVerifications.completeVerification(user.id);
  return { user: toPublicUser(user), session: await createSession(user.id, userAgent) };
}

// ---------- Recuperação de senha ----------

// Sempre termina sem erro, exista o e-mail ou não: quem pergunta não descobre quais e-mails têm conta
export async function requestPasswordReset(email: string) {
  const user = await userRepository.findByEmail(email);
  if (!user) return;

  const last = await passwordResets.findLatest(user.id);
  if (last && Date.now() - last.createdAt.getTime() < CODE_COOLDOWN_MS) return;

  const code = newCode();
  await passwordResets.replaceCode(user.id, hmac(`${user.id}:${code}`), codeExpiry());
  await sendPasswordResetCode(user.email, code);
}

// Mesma resposta para e-mail inexistente, código errado, vencido ou esgotado: não vaza qual foi o caso
const invalidCode = () => new BadRequestError("Código inválido ou expirado", "INVALID_RESET_CODE");

export async function resetPassword(input: ResetPasswordInput) {
  const user = await userRepository.findByEmail(input.email);
  if (!user) throw invalidCode();

  const reset = await passwordResets.findUsable(user.id, config.resetMaxAttempts);
  if (!reset) throw invalidCode();

  if (!codeMatches(reset.codeHash, user.id, input.code)) {
    await passwordResets.incrementAttempts(reset.id);
    throw invalidCode();
  }

  await passwordResets.completeReset(user.id, await hashPassword(input.newPassword));
}
