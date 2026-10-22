import { prisma } from "../db";
import { DAY_START_SECONDS } from "../game/constants";

// Sementes que todo jogador novo recebe (id do item -> quantidade)
const INITIAL_INVENTORY: Record<string, number> = { corn: 3, tomato: 3, pumpkin: 2 };

// Cria o jogador e já cria o save inicial dele (um terreno vazio em 0,0 e as sementes) na mesma transação
export function createGuestPlayer() {
  return prisma.user.create({
    data: {
      displayName: "Convidado",
      save: {
        create: {
          gameStartedAt: new Date(Date.now() - DAY_START_SECONDS * 1000),
          plots: { create: { x: 0, y: 0 } },
          inventory: { create: Object.entries(INITIAL_INVENTORY).map(([itemId, quantity]) => ({ itemId, quantity })) },
        },
      },
    },
  });
}
