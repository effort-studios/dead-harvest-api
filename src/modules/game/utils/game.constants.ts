import { config } from "../../../config";

// Regras do jogo que o servidor precisa conhecer
export const GRID_SIZE = 10 // cada terreno é 10x10
export const DAY_LENGTH_SECONDS = config.dayLengthSeconds // dia inteiro (DAY_LENGTH_SECONDS no .env; padrão 24 min)
// Início do mundo: dia e hora do jogo contam a partir daqui, iguais para todos os jogadores (WORLD_EPOCH no .env)
export const WORLD_EPOCH_MS = config.worldEpoch
// O dia vira à meia-noite (time 0 = 00h) e o relógio é linear (24h no dia inteiro): o relógio é o do mundo, não o do save
export const DAY_START_SECONDS = Math.round((DAY_LENGTH_SECONDS * 6) / 24)

// Terreno novo: 1000 o segundo e +50% a cada terreno comprado
export const PLOT_BASE_PRICE = 1000
export const PLOT_PRICE_FACTOR = 1.5

export const plotPrice = (ownedPlots: number) => Math.round(PLOT_BASE_PRICE * PLOT_PRICE_FACTOR ** (ownedPlots - 1))

// Fila do fazendeiro: no máximo este tanto de pedidos pendentes por jogador
export const MAX_FARM_JOBS = 100

// Celeiro: o jogador constrói onde quiser; compra com 4 baias e amplia de 2 em 2 (400 a 1ª ampliação, +50% a cada uma)
export const BARN = {
  price: 500,
  startCapacity: 4,
  expandBy: 2,
  maxCapacity: 12,
  expandBasePrice: 400,
  expandFactor: 1.5,
}
export const barnExpandPrice = (capacity: number) =>
  Math.round(BARN.expandBasePrice * BARN.expandFactor ** ((capacity - BARN.startCapacity) / BARN.expandBy))

// Adubo (feito na Composteira, de tomate ou do esterco dos animais) e água (do regador): cada um faz a planta
// crescer 30% mais rápido, e os dois somam (60%). Valem antes ou depois de plantar; a colheita tira os dois.
export const FERTILIZER_ITEM = "fertilizer"
export const GROWTH_BONUS = { fertilizer: 0.3, water: 0.3 }

// Regador: compra uma vez na loja, vem cheio; cada tile regado gasta 1 carga; enche de novo no poço
export const WATERING_CAN = { price: 250, charges: 10 }
// Poço: prédio de 1 célula onde o fazendeiro enche o regador
export const WELL = { price: 400 }
