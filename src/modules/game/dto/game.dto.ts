import { z } from "zod";
import { GRID_SIZE } from "../utils/game.constants";

// Corpo das ações do jogo. O cliente só diz O QUE quer fazer; quanto custa, se pode e o resultado
// quem decide é o servidor (services/game-actions.service.ts).

const id = z.string().min(1).max(30);
const cell = z.number().int().min(0).max(GRID_SIZE - 1);

// Ação em tiles de um terreno: um tile ou a linha/coluna inteira (até 10)
export const tilesSchema = z.object({
  x: z.number().int(), // terreno na malha de terrenos
  y: z.number().int(),
  tiles: z
    .array(z.object({ row: cell, col: cell }))
    .min(1)
    .max(GRID_SIZE)
    .refine((list) => new Set(list.map((t) => `${t.row},${t.col}`)).size === list.length, "Tile repetido"),
});

export const plantSchema = tilesSchema.extend({ cropId: id });

export const buySeedSchema = z.object({ cropId: id, quantity: z.number().int().min(1).max(99) });

// Sem quantity = vende todas
export const sellFruitSchema = z.object({ itemId: id, quantity: z.number().int().min(1).max(9999).optional() });

export const buyPlotSchema = z.object({ x: z.number().int().min(-50).max(50), y: z.number().int().min(-50).max(50) });

export type TilesInput = z.infer<typeof tilesSchema>;

export const treeParams = z.object({ treeId: id });
