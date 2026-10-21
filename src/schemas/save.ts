import { z } from "zod";

// Formato do save. Precisa ser igual ao tipo SaveData do front (documentado no README).
export const tileSchema = z.object({
  state: z.enum(["soil", "tilled", "planted"]), // terra, arada, plantada
  crop: z.string().max(30).nullable(), // tipo da planta (null se não houver)
  growth: z.number().int().min(0), // ticks de crescimento acumulados
});

export const saveSchema = z.object({
  day: z.number().int().min(1),
  money: z.number().int().min(0),
  grid: z.array(z.array(tileSchema).length(10)).length(10), // grade 10x10
  inventory: z.record(z.string().max(30), z.number().int().min(0)), // ex.: { wheat: 3 }
});

export type SaveData = z.infer<typeof saveSchema>;

// Save inicial de um jogador novo
export function newSave(): SaveData {
  return {
    day: 1,
    money: 100,
    grid: Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => ({ state: "soil" as const, crop: null, growth: 0 })),
    ),
    inventory: { wheat: 3 },
  };
}
