import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { type Avatar } from "../game/avatar";
import { DAY_START_SECONDS } from "../game/constants";
import { sendPasswordResetCode } from "./mailer";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password";

// Erro com o status HTTP que a rota deve devolver
export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Sementes que todo jogador novo recebe (id do item -> quantidade)
const INITIAL_INVENTORY: Record<string, number> = { corn: 3, tomato: 3, pumpkin: 2 };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (value: string) => createHmac("sha256", config.authSecret).update(value).digest("hex");
type UserRow = {
  id: string;
  email: string;
  displayName: string;
  avatarSkin: string;
  avatarFace: string;
  avatarHat: string;
  avatarBeard: string;
  avatarOutfit: string;
};

// O que o front pode saber do usuário (nunca o hash da senha)
const publicUser = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  avatar: { skin: u.avatarSkin, face: u.avatarFace, hat: u.avatarHat, beard: u.avatarBeard, outfit: u.avatarOutfit } as Avatar,
});

export type PublicUser = ReturnType<typeof publicUser>;

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
  return publicUser(session.user);
}

export async function logout(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

// ---------- Perfil ----------

// Muda o nome e/ou o avatar. Os ids das peças já chegam validados pela rota (e o banco confere de novo).
export async function updateProfile(userId: string, input: { displayName?: string; avatar?: Avatar }) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      displayName: input.displayName,
      ...(input.avatar && {
        avatarSkin: input.avatar.skin,
        avatarFace: input.avatar.face,
        avatarHat: input.avatar.hat,
        avatarBeard: input.avatar.beard,
        avatarOutfit: input.avatar.outfit,
      }),
    },
  });
  return publicUser(user);
}

// ---------- Cadastro e login ----------

export async function register(input: { email: string; password: string; displayName: string }, userAgent?: string) {
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
    return { user: publicUser(user), session: await createSession(user.id, userAgent) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AuthError(409, "Já existe uma conta com este e-mail");
    }
    throw err;
  }
}

export async function login(input: { email: string; password: string }, userAgent?: string) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Mesmo sem usuário, gasta o tempo de verificar uma senha: a resposta não revela se o e-mail existe
  const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new AuthError(401, "E-mail ou senha inválidos");
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { user: publicUser(user), session: await createSession(user.id, userAgent) };
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

const INVALID_CODE = "Código inválido ou expirado";

export async function resetPassword(input: { email: string; code: string; newPassword: string }) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new AuthError(400, INVALID_CODE);

  const reset = await prisma.passwordReset.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: config.resetMaxAttempts } },
    orderBy: { createdAt: "desc" },
  });
  if (!reset) throw new AuthError(400, INVALID_CODE);

  const expected = Buffer.from(reset.codeHash);
  const actual = Buffer.from(hmac(`${user.id}:${input.code}`));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
    throw new AuthError(400, INVALID_CODE);
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    // quem tinha a senha antiga (ou a roubou) perde o acesso: todas as sessões caem
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
}
