import { config } from "../config";

// Regras do jogo que o servidor precisa conhecer
export const GRID_SIZE = 10 // cada terreno é 10x10
export const DAY_LENGTH_SECONDS = config.dayLengthSeconds // dia inteiro (DAY_LENGTH_SECONDS no .env; padrão 24 min)
export const DAY_START_SECONDS = Math.round(DAY_LENGTH_SECONDS / 4) // jogo novo começa no início da manhã (fim do amanhecer)

// Terreno novo: 1000 o segundo e +50% a cada terreno comprado
export const PLOT_BASE_PRICE = 1000
export const PLOT_PRICE_FACTOR = 1.5

export const plotPrice = (ownedPlots: number) => Math.round(PLOT_BASE_PRICE * PLOT_PRICE_FACTOR ** (ownedPlots - 1))
