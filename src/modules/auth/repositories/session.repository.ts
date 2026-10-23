import { prisma } from "../../../shared/database/prisma";

// No banco fica só o hash do token; o token em si vive no cookie do navegador
export const create = (data: { userId: string; tokenHash: string; expiresAt: Date; userAgent?: string }) =>
  prisma.session.create({ data });

export const findByTokenHash = (tokenHash: string) => prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });

export const deleteByTokenHash = (tokenHash: string) => prisma.session.deleteMany({ where: { tokenHash } });
