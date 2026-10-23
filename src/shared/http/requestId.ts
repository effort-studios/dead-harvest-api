import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

// Id por requisição: vai no cabeçalho da resposta e no log de erro, para achar o stack de um 500 reportado.
// Sempre gerado aqui (um id vindo do cliente poderia ser forjado para poluir o log).
export const requestId: RequestHandler = (_req, res, next) => {
  const id = randomUUID();
  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
};
