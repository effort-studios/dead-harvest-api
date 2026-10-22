import { prisma } from "../db";
import type { SaveData } from "../schemas/save";

export function getSave(playerId: string) {
  return prisma.save.findUnique({ where: { userId: playerId } });
}

// Retorna null se o jogador não existe (o código P2025 do Prisma = registro não encontrado)
export async function updateSave(playerId: string, data: SaveData) {
  try {
    return await prisma.save.update({ where: { userId: playerId }, data });
  } catch (err: any) {
    if (err.code === "P2025") return null;
    throw err;
  }
}
