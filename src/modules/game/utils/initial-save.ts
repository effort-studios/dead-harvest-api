import type { InitialSave } from "../../users/repositories/user.repository";

// Sementes que todo jogador novo recebe (id do item -> quantidade)
const INITIAL_INVENTORY: Record<string, number> = { corn: 3, tomato: 3, pumpkin: 2 };

// Jogo novo: um terreno vazio em 0,0, as sementes iniciais (o relógio é do mundo, igual para todos)
export function initialSave(now = Date.now()): InitialSave {
  return {
    gameStartedAt: new Date(now),
    plots: [{ x: 0, y: 0 }],
    inventory: Object.entries(INITIAL_INVENTORY).map(([itemId, quantity]) => ({ itemId, quantity })),
  };
}
