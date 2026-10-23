import { app } from "./app";
import { config } from "./config";
import { prisma } from "./shared/database/prisma";

const server = app.listen(config.port, () => {
  console.log(`API rodando em http://localhost:${config.port}`);
});

// Encerra sem cortar requisições em andamento: para de aceitar novas, espera as atuais e fecha o banco
function shutdown(signal: string) {
  console.log(`${signal} recebido, encerrando...`);
  const force = setTimeout(() => process.exit(1), 10_000); // trava no meio do caminho: sai à força
  force.unref();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Falha que ninguém tratou: registra e derruba o processo (o gerenciador de processos sobe de novo)
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err);
  process.exit(1);
});
