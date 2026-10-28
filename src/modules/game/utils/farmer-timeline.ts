import { config } from "../../../config";

// Linha do tempo do fazendeiro: cada pedido da fila começa quando o anterior termina, e leva o tempo de
// andar até o alvo mais o do gesto. Tudo é conta em cima de timestamps, então dá para calcular o que
// aconteceu enquanto ninguém estava olhando (o jogo fechado, o servidor reiniciando).

export type Cell = { row: number; col: number };
export type Schedule = { startsAt: number; arriveAt: number; endsAt: number };

export const distance = (a: Cell, b: Cell) => Math.hypot(a.row - b.row, a.col - b.col);

export function schedule(from: Cell, to: Cell, startsAt: number): Schedule {
  const arriveAt = startsAt + Math.round((distance(from, to) / config.farmerWalkSpeed) * 1000);
  return { startsAt, arriveAt, endsAt: arriveAt + config.farmerActMs };
}

// Andar livre (WASD): o cliente anda sozinho e avisa de onde está. O servidor só confere se dá tempo de ter
// chegado: do último aviso até agora ele anda no máximo velocidade x tempo (com folga para a latência).
// Passou disso, para no ponto mais longe que alcançaria, em linha reta até onde o cliente disse.
// O tempo conta desde o aviso "start" (ou o último aviso), então só há crédito de caminhada de quem avisou
// que começou a andar: sem "start" não há horário e o crédito é só a folga fixa.
export const WALK_TOLERANCE = 1.25; // folga sobre a velocidade (jitter de rede e de relógio)
export const WALK_SLACK_CELLS = 0.5; // folga fixa
export const WALK_MAX_WINDOW_MS = 60_000; // teto de um trecho sem aviso (o cliente avisa a cada poucos segundos)

export function clampWalk(from: Cell, to: Cell, elapsedMs: number): Cell {
  const window = Math.min(Math.max(elapsedMs, 0), WALK_MAX_WINDOW_MS);
  const reach = (config.farmerWalkSpeed * window) / 1000 * WALK_TOLERANCE + WALK_SLACK_CELLS;
  const dist = distance(from, to);
  if (dist <= reach) return to;
  const f = reach / dist;
  return { row: from.row + (to.row - from.row) * f, col: from.col + (to.col - from.col) * f };
}

// Onde o fazendeiro está em `now`, andando de `from` para `to` conforme o `schedule`
export function positionAt(from: Cell, to: Cell, s: Schedule, now: number): Cell {
  if (now >= s.arriveAt) return to;
  const f = Math.min(Math.max((now - s.startsAt) / (s.arriveAt - s.startsAt), 0), 1);
  return { row: from.row + (to.row - from.row) * f, col: from.col + (to.col - from.col) * f };
}
