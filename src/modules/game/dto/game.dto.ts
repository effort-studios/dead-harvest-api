import { z } from "zod";
import { GRID_SIZE } from "../utils/game.constants";

// Corpo das ações do jogo. O cliente só diz O QUE quer fazer; quanto custa, se pode e o resultado
// quem decide é o servidor (services/game-actions.service.ts).

const id = z.string().min(1).max(30);
const cell = z.number().int().min(0).max(GRID_SIZE - 1);
// Terreno na malha de terrenos. Sem limite, um número gigante estoura o INT do banco (500)
const plotCoord = z.number().int().min(-50).max(50);

// Ação em tiles de um terreno: um tile ou a linha/coluna inteira (até 10)
export const tilesSchema = z.object({
  x: plotCoord,
  y: plotCoord,
  tiles: z
    .array(z.object({ row: cell, col: cell }))
    .min(1)
    .max(GRID_SIZE)
    .refine((list) => new Set(list.map((t) => `${t.row},${t.col}`)).size === list.length, "Tile repetido"),
});

export const plantSchema = tilesSchema.extend({ cropId: id });

export const buySeedSchema = z.object({ cropId: id, quantity: z.number().int().min(1).max(99) });

// Sem quantity = vende todas
export const sellItemSchema = z.object({ itemId: id, quantity: z.number().int().min(1).max(9999).optional() });

export const startRecipeSchema = z.object({ recipeId: id });
export const buyAnimalSchema = z.object({ animalId: id });

// Prédio construído (ou arrastado) na célula (row, col) do mapa; as regras de lugar ficam no serviço
const mapCell = z.number().int().min(-100).max(100);
export const buyMachineSchema = z.object({ machineId: id, row: mapCell, col: mapCell });
export const buyBarnSchema = z.object({ row: mapCell, col: mapCell });
export const buyWellSchema = buyBarnSchema;
export const moveBuildingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("machine"), machineId: id, row: mapCell, col: mapCell }),
  z.object({ kind: z.literal("barn"), row: mapCell, col: mapCell }),
  z.object({ kind: z.literal("well"), row: mapCell, col: mapCell }),
]);
export type MoveBuildingInput = z.infer<typeof moveBuildingSchema>;

export const buyPlotSchema = z.object({ x: plotCoord, y: plotCoord });

export type TilesInput = z.infer<typeof tilesSchema>;

export const treeParams = z.object({ treeId: id });

// Pedido para o fazendeiro: o cliente diz O QUE fazer e em quais tiles; quem decide a ordem, o tempo e se
// dá certo é o servidor (services/farmer.service.ts)
export const enqueueSchema = z.discriminatedUnion("action", [
  tilesSchema.extend({ action: z.enum(["till", "untill", "harvest", "fertilize", "water"]) }),
  plantSchema.extend({ action: z.literal("plant") }),
  z.object({ action: z.literal("harvest_tree"), treeId: id }),
  z.object({ action: z.literal("collect_machine"), machineId: id }),
  z.object({ action: z.literal("collect_barn") }),
  z.object({ action: z.literal("refill_can") }),
  z.object({ action: z.literal("move"), row: mapCell, col: mapCell }), // só andar até a célula
]);
export type EnqueueInput = z.infer<typeof enqueueSchema>;

// Andar livre: para onde o cliente diz que o fazendeiro chegou (com fração). O servidor limita pela velocidade.
export const walkSchema = z.object({ row: z.number().min(-100).max(100), col: z.number().min(-100).max(100) });
export type WalkInput = z.infer<typeof walkSchema>;

export const jobParams = z.object({ jobId: z.string().uuid() });
