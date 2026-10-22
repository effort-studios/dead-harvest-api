// Regras do jogo que o servidor precisa conhecer
export const GRID_SIZE = 10 // cada terreno é 10x10
export const DAY_LENGTH_SECONDS = 300 // um dia inteiro dura 5 minutos
export const DAY_START_SECONDS = 75 // jogo novo começa no início da manhã

// Terreno novo: 1000 o segundo e +50% a cada terreno comprado
export const PLOT_BASE_PRICE = 1000
export const PLOT_PRICE_FACTOR = 1.5

export const plotPrice = (ownedPlots: number) => Math.round(PLOT_BASE_PRICE * PLOT_PRICE_FACTOR ** (ownedPlots - 1))
