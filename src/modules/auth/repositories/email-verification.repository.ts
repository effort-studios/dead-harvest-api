import { prisma } from "../../../shared/database/prisma";

export const findLatest = (userId: string) => prisma.emailVerification.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });

// Pedido ainda utilizável: não usado, não vencido e com tentativas sobrando
export const findUsable = (userId: string, maxAttempts: number) =>
  prisma.emailVerification.findFirst({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: maxAttempts } },
    orderBy: { createdAt: "desc" },
  });

// Um código novo invalida os anteriores
export const replaceCode = (userId: string, codeHash: string, expiresAt: Date) =>
  prisma.$transaction([
    prisma.emailVerification.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.emailVerification.create({ data: { userId, codeHash, expiresAt } }),
  ]);

export const incrementAttempts = (id: string) => prisma.emailVerification.update({ where: { id }, data: { attempts: { increment: 1 } } });

// Marca o e-mail como confirmado e queima os pedidos pendentes, numa transação só
export const completeVerification = (userId: string) =>
  prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date(), lastLoginAt: new Date() } }),
    prisma.emailVerification.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
  ]);
