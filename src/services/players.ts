import { prisma } from "../db";
import { newSave } from "../schemas/save";

// Cria o jogador e já cria o save inicial dele na mesma transação
export function createGuestPlayer() {
  const { day, money, plots, inventory } = newSave();
  return prisma.user.create({
    data: {
      displayName: "Convidado",
      save: { create: { day, money, plots, inventory } },
    },
  });
}
