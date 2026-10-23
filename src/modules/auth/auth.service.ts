import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { config } from "../../config";
import { prisma } from "../../shared/database/prisma";
import { BadRequestError, ConflictError, UnauthorizedError } from "../../shared/errors/AppError";
import { DAY_START_SECONDS } from "../game/game.constants";
import { toPublicUser, type PublicUser } from "../users/user.mapper";
import { sendPasswordResetCode } from "./mailer.service";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password.service";
import type { LoginInput, RegisterInput, ResetPasswordInput } from "./auth.schemas";

// Sementes que todo jogador novo recebe (id do item -> quantidade)
const INITIAL_INVENTORY: Record<string, number> = { corn: 3, tomato: 3, pumpkin: 2 };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (value: string) => createHmac("sha256", config.authSecret).update(value).digest("hex");

// ---------- Sessão ----------

// O token (aleatório, 256 bits) vai só para o cookie do navegador; no banco fica o hash dele
async function createSession(userId: string, userAgent: string | undefined) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { userId, tokenHash: sha256(token), expiresAt, userAgent: userAgent?.slice(0, 300) } });
  return { token, expiresAt };
}

export async function userFromSession(token: string): Promise<PublicUser | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date()) return null;
  return toPublicUser(session.user);
}

export async function logout(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

// ---------- Cadastro e login ----------

export async function register(input: RegisterInput, userAgent?: string) {
  const passwordHash = await hashPassword(input.password);
  try {
    // O usuário já nasce com o save inicial: um terreno vazio em 0,0 e as sementes
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        lastLoginAt: new Date(),
        save: {
          create: {
            gameStartedAt: new Date(Date.now() - DAY_START_SECONDS * 1000),
            plots: { create: { x: 0, y: 0 } },
            inventory: { create: Object.entries(INITIAL_INVENTORY).map(([itemId, quantity]) => ({ itemId, quantity })) },
          },
        },
      },
    });
    return { user: toPublicUser(user), session: await createSession(user.id, userAgent) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("Já existe uma conta com este e-mail", "EMAIL_TAKEN");
    }
    throw err;
  }
}

export async function login(input: LoginInput, userAgent?: string) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Mesmo sem usuário, gasta o tempo de verificar uma senha: a resposta não revela se o e-mail existe
  const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new UnauthorizedError("E-mail ou senha inválidos", "INVALID_CREDENTIALS");
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { user: toPublicUser(user), session: await createSession(user.id, userAgent) };
}

// ---------- Recuperação de senha ----------

const RESET_COOLDOWN_MS = 60 * 1000; // no máximo 1 código por minuto por usuário

// Sempre termina sem erro, exista o e-mail ou não: quem pergunta não descobre quais e-mails têm conta
export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;

  const last = await prisma.passwordReset.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < RESET_COOLDOWN_MS) return;

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.$transaction([
    // um código novo invalida os anteriores
    prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordReset.create({
      data: { userId: user.id, codeHash: hmac(`${user.id}:${code}`), expiresAt: new Date(Date.now() + config.resetCodeMinutes * 60 * 1000) },
    }),
  ]);
  await sendPasswordResetCode(user.email, code);
}

// Mesma resposta para e-mail inexistente, código errado, vencido ou esgotado: não vaza qual foi o caso
const invalidCode = () => new BadRequestError("Código inválido ou expirado", "INVALID_RESET_CODE");

export async function resetPassword(input: ResetPasswordInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw invalidCode();

  const reset = await prisma.passwordReset.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: config.resetMaxAttempts } },
    orderBy: { createdAt: "desc" },
  });
  if (!reset) throw invalidCode();

  const expected = Buffer.from(reset.codeHash);
  const actual = Buffer.from(hmac(`${user.id}:${input.code}`));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
    throw invalidCode();
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    // quem tinha a senha antiga (ou a roubou) perde o acesso: todas as sessões caem
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
}
