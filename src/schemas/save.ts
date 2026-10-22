import { z } from "zod";

// Formato do save. Precisa ser igual ao tipo SaveData do front (documentado no README).
export const tileSchema = z.object({
  state: z.enum(["soil", "tilled", "planted"]), // terra, arada, plantada
  crop: z.string().max(30).nullable(), // tipo da planta (null se não houver)
  growth: z.number().int().min(0), // ticks de crescimento acumulados
});

// Terreno 10x10; (x, y) é a posição do terreno na malha de terrenos (o inicial é 0,0)
export const plotSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  grid: z.array(z.array(tileSchema).length(10)).length(10), // grade 10x10
});

export const saveSchema = z.object({
  day: z.number().int().min(1),
  time: z.number().int().min(0).max(100000).default(120), // segundos do dia; o front define a duração do dia
  money: z.number().int().min(0),
  plots: z.array(plotSchema).min(1),
  inventory: z.record(z.string().max(30), z.number().int().min(0)), // ex.: { corn: 3 }
  trees: z.record(z.string().max(30), z.number().int().min(0)).default({}), // id da árvore -> ms da última coleta
});

export type SaveData = z.infer<typeof saveSchema>;

// Save inicial de um jogador novo
export function newSave(): SaveData {
  return {
    day: 1,
    time: 120,
    money: 100,
    plots: [
      {
        x: 0,
        y: 0,
        grid: Array.from({ length: 10 }, () =>
          Array.from({ length: 10 }, () => ({ state: "soil" as const, crop: null, growth: 0 })),
        ),
      },
    ],
    inventory: { corn: 3, tomato: 3, pumpkin: 2 }, // sementes iniciais; a loja (item 5) vende mais
    trees: {},
  };
}
