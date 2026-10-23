import { NotFoundError } from "../../../shared/errors/AppError";
import { toGameState, type GameState } from "../entities/game-state";
import * as gameRepository from "../repositories/game.repository";

// Estado do jogo do jogador; recebe o `db` da transação quando chamado de dentro de uma ação
export async function loadState(db: gameRepository.Db, userId: string, now: number): Promise<GameState> {
  const save = await gameRepository.findSaveState(db, userId);
  if (!save) throw new NotFoundError("Save não encontrado", "SAVE_NOT_FOUND");
  return toGameState(save, now);
}

export const getState = (userId: string) => loadState(gameRepository.defaultDb, userId, Date.now());
