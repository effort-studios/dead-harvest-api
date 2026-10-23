import type { InitialSave } from "../../users/repositories/user.repository";
import { DAY_START_SECONDS } from "./game.constants";

// Sementes que todo jogador novo recebe (id do item -> quantidade)
const INITIAL_INVENTORY: Record<string, number> = { corn: 3, tomato: 3, pumpkin: 2 };

// Jogo novo: um terreno vazio em 0,0, as sementes iniciais e o relógio começando no início da manhã
export function initialSave(now = Date.now()): InitialSave {
  return {
    gameStartedAt: new Date(now - DAY_START_SECONDS * 1000),
    plots: [{ x: 0, y: 0 }],
    inventory: Object.entries(INITIAL_INVENTORY).map(([itemId, quantity]) => ({ itemId, quantity })),
  };
}
