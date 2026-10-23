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

// Onde o fazendeiro está em `now`, andando de `from` para `to` conforme o `schedule`
export function positionAt(from: Cell, to: Cell, s: Schedule, now: number): Cell {
  if (now >= s.arriveAt) return to;
  const f = Math.min(Math.max((now - s.startsAt) / (s.arriveAt - s.startsAt), 0), 1);
  return { row: from.row + (to.row - from.row) * f, col: from.col + (to.col - from.col) * f };
}
