import express, { type Express, type Router } from "express";
import { errorHandler } from "../../src/shared/http/errorHandler";
import { notFound } from "../../src/shared/http/notFound";
import { requestId } from "../../src/shared/http/requestId";

// App mínimo, com a mesma "moldura" do app real (requestId, JSON, 404 e errorHandler), para testar
// middlewares e o tratamento de erro sem banco: quem chama registra as rotas de teste.
export function buildApp(register: (router: Router) => void): Express {
  const app = express();
  const router = express.Router();
  app.use(requestId);
  app.use(express.json({ limit: "1kb" }));
  register(router);
  app.use(router);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
