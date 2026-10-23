import type { RequestHandler } from "express";
import { NotFoundError } from "../errors/AppError";

// Rota que não existe: 404 em JSON (o padrão do Express é uma página HTML)
export const notFound: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Rota ${req.method} ${req.path} não encontrada`, "ROUTE_NOT_FOUND"));
};
