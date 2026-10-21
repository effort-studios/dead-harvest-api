import { prisma } from "../db";
import { newSave } from "../schemas/save";

// Cria o jogador e já cria o save inicial dele na mesma transação
export function createGuestPlayer() {
  const { day, money, grid, inventory } = newSave();
  return prisma.player.create({
    data: {
      name: "Convidado",
      save: { create: { day, money, grid, inventory } },
    },
  });
}
