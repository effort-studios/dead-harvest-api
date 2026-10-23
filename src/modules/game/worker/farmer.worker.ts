import * as farmer from "../services/farmer.service";
import * as repo from "../repositories/game.repository";

// Worker da fila do fazendeiro: a cada segundo põe em dia a fila de quem tem pedidos pendentes, para a
// fazenda continuar trabalhando com o jogo fechado (ou depois de um F5). Roda no mesmo processo da API.
// Vários processos rodando ao mesmo tempo não atrapalham: cada jogador é processado numa transação com
// o save travado (FOR UPDATE).

const INTERVAL_MS = 1000;

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

async function round() {
  if (running) return; // rodada anterior ainda não acabou
  running = true;
  try {
    for (const userId of await repo.userIdsWithJobs()) {
      // erro de um jogador não pode parar os outros
      await farmer.tick(userId).catch((err) => console.error("farmer worker", userId, err));
    }
  } catch (err) {
    console.error("farmer worker", err);
  } finally {
    running = false;
  }
}

export function startFarmerWorker() {
  timer ??= setInterval(round, INTERVAL_MS);
}

export function stopFarmerWorker() {
  clearInterval(timer);
  timer = undefined;
}
