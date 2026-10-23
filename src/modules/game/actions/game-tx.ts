import type { Prisma } from "@prisma/client";
import { prisma } from "../../../shared/database/prisma";
import { NotFoundError } from "../../../shared/errors/AppError";
import { loadState, type GameState } from "../state/game-state.service";

// Peças em comum das ações do jogo: a transação com o save travado e os helpers de dinheiro/inventário/terreno.

export type Tx = Prisma.TransactionClient;
type LockedSave = { id: string; money: number };

// Roda a ação com o save do jogador travado (FOR UPDATE): ações ao mesmo tempo (cliques rápidos, duas
// abas, dois aparelhos) entram em fila e cada uma vê o resultado da anterior. Devolve o estado novo.
// Se a ação lançar, a transação inteira é desfeita.
export async function act(userId: string, action: (tx: Tx, save: LockedSave, now: number) => Promise<void>): Promise<GameState> {
  return prisma.$transaction(async (tx) => {
    const now = Date.now();
    const [save] = await tx.$queryRaw<LockedSave[]>`SELECT id, money FROM saves WHERE user_id = ${userId}::uuid FOR UPDATE`;
    if (!save) throw new NotFoundError("Save não encontrado", "SAVE_NOT_FOUND");
    await action(tx, save, now);
    return (await loadState(tx, userId, now))!;
  });
}

export async function findPlot(tx: Tx, saveId: string, x: number, y: number) {
  const plot = await tx.plot.findUnique({ where: { saveId_x_y: { saveId, x, y } }, include: { tiles: { include: { crop: true } } } });
  if (!plot) throw new NotFoundError("Terreno não encontrado", "PLOT_NOT_FOUND");
  return plot;
}

export const tileKey = (t: { row: number; col: number }) => `${t.row},${t.col}`;

export const changeMoney = (tx: Tx, saveId: string, amount: number) =>
  tx.save.update({ where: { id: saveId }, data: { money: { increment: amount } } });

export async function itemCount(tx: Tx, saveId: string, itemId: string) {
  const row = await tx.inventoryItem.findUnique({ where: { saveId_itemId: { saveId, itemId } } });
  return row?.quantity ?? 0;
}

export const addItem = (tx: Tx, saveId: string, itemId: string, quantity: number) =>
  tx.inventoryItem.upsert({
    where: { saveId_itemId: { saveId, itemId } },
    create: { saveId, itemId, quantity },
    update: { quantity: { increment: quantity } },
  });

// Tira do inventário; quem chama já conferiu que há o bastante. Zerou, a linha some (o banco não aceita 0).
export async function removeItem(tx: Tx, saveId: string, itemId: string, quantity: number, have: number) {
  const where = { saveId_itemId: { saveId, itemId } };
  if (have === quantity) await tx.inventoryItem.delete({ where });
  else await tx.inventoryItem.update({ where, data: { quantity: { decrement: quantity } } });
}
