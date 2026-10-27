import { GROWTH_BONUS } from "./game.constants";

// Crescimento de uma planta em segundos "de planta". É acumulado: `growth` segundos até `growthAt`, e daí em
// diante cresce na velocidade do tile (mais rápido com adubo e regado). Quando o tile ganha adubo ou água com a
// planta já crescendo, o acumulado é acertado antes (settleGrowth), para o bônus não valer para trás. A planta
// está madura quando isto chega a crops.grow_seconds.

export type GrowingTile = { fertilized: boolean; watered: boolean; growth: number; growthAt: Date | null };

export const growthRate = (t: { fertilized: boolean; watered: boolean }) =>
  1 + (t.fertilized ? GROWTH_BONUS.fertilizer : 0) + (t.watered ? GROWTH_BONUS.water : 0);

export function growthSeconds(t: GrowingTile, now: number): number {
  if (!t.growthAt) return t.growth;
  return t.growth + (Math.max(0, now - t.growthAt.getTime()) / 1000) * growthRate(t);
}

// Crescimento acumulado até agora, para gravar antes de mudar a velocidade do tile
export const settleGrowth = (t: GrowingTile, now: number) => ({ growth: growthSeconds(t, now), growthAt: new Date(now) });
