import { prisma } from "../../../shared/database/prisma";

export const findLatest = (userId: string) => prisma.passwordReset.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });

// Pedido ainda utilizável: não usado, não vencido e com tentativas sobrando
export const findUsable = (userId: string, maxAttempts: number) =>
  prisma.passwordReset.findFirst({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: maxAttempts } },
    orderBy: { createdAt: "desc" },
  });

// Um código novo invalida os anteriores
export const replaceCode = (userId: string, codeHash: string, expiresAt: Date) =>
  prisma.$transaction([
    prisma.passwordReset.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordReset.create({ data: { userId, codeHash, expiresAt } }),
  ]);

export const incrementAttempts = (id: string) => prisma.passwordReset.update({ where: { id }, data: { attempts: { increment: 1 } } });

// Troca a senha, queima os pedidos pendentes e derruba todas as sessões, numa transação só:
// quem tinha a senha antiga (ou a roubou) perde o acesso.
export const completeReset = (userId: string, passwordHash: string) =>
  prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.passwordReset.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
