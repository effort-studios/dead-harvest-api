import { prisma } from "../../../shared/database/prisma";

// Estado inicial do jogo de quem acabou de criar a conta (quem define o conteúdo é o módulo game)
export type InitialSave = {
  gameStartedAt: Date;
  plots: { x: number; y: number }[];
  inventory: { itemId: string; quantity: number }[];
};

export const findByEmail = (email: string) => prisma.user.findUnique({ where: { email } });

// Cria o usuário já com o save inicial, na mesma transação. E-mail repetido lança P2002 (unique).
export const createWithSave = (input: { email: string; passwordHash: string; displayName: string; save: InitialSave }) =>
  prisma.user.create({
    data: {
      email: input.email,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      lastLoginAt: new Date(),
      save: {
        create: {
          gameStartedAt: input.save.gameStartedAt,
          plots: { create: input.save.plots },
          inventory: { create: input.save.inventory },
        },
      },
    },
  });

export const touchLastLogin = (id: string) => prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });

// Usuário que não existe: o Prisma lança P2025, que o errorHandler responde como 404
export const updateProfile = (id: string, data: { displayName?: string } & Partial<Record<`avatar${string}`, string>>) =>
  prisma.user.update({ where: { id }, data });
