import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../../../config";
import { isPrismaError } from "../../../shared/database/prisma-errors";
import { BadRequestError, ConflictError, UnauthorizedError } from "../../../shared/errors/AppError";
import { initialSave } from "../../game/utils/initial-save";
import { toPublicUser, type PublicUser } from "../../users/entities/public-user";
import * as userRepository from "../../users/repositories/user.repository";
import type { LoginInput, RegisterInput, ResetPasswordInput } from "../dto/auth.dto";
import type { AuthSession } from "../entities/auth-session";
import * as passwordResets from "../repositories/password-reset.repository";
import * as sessions from "../repositories/session.repository";
import { sendPasswordResetCode } from "../utils/mailer";
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

export async function register(input: RegisterInput, userAgent?: string) {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await userRepository.createWithSave({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
      save: initialSave(),
    });
    return { user: toPublicUser(user), session: await createSession(user.id, userAgent) };
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
  await userRepository.touchLastLogin(user.id);
  return { user: toPublicUser(user), session: await createSession(user.id, userAgent) };
}

// ---------- Recuperação de senha ----------

const RESET_COOLDOWN_MS = 60 * 1000; // no máximo 1 código por minuto por usuário

// Sempre termina sem erro, exista o e-mail ou não: quem pergunta não descobre quais e-mails têm conta
export async function requestPasswordReset(email: string) {
  const user = await userRepository.findByEmail(email);
  if (!user) return;

  const last = await passwordResets.findLatest(user.id);
  if (last && Date.now() - last.createdAt.getTime() < RESET_COOLDOWN_MS) return;

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await passwordResets.replaceCode(user.id, hmac(`${user.id}:${code}`), new Date(Date.now() + config.resetCodeMinutes * 60 * 1000));
  await sendPasswordResetCode(user.email, code);
}

// Mesma resposta para e-mail inexistente, código errado, vencido ou esgotado: não vaza qual foi o caso
const invalidCode = () => new BadRequestError("Código inválido ou expirado", "INVALID_RESET_CODE");

export async function resetPassword(input: ResetPasswordInput) {
  const user = await userRepository.findByEmail(input.email);
  if (!user) throw invalidCode();

  const reset = await passwordResets.findUsable(user.id, config.resetMaxAttempts);
  if (!reset) throw invalidCode();

  const expected = Buffer.from(reset.codeHash);
  const actual = Buffer.from(hmac(`${user.id}:${input.code}`));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await passwordResets.incrementAttempts(reset.id);
    throw invalidCode();
  }

  await passwordResets.completeReset(user.id, await hashPassword(input.newPassword));
}
