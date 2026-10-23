import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError";
import { issueDetails } from "./validate";

export type HttpError = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  headers?: Record<string, string>;
};

const INTERNAL: HttpError = { status: 500, code: "INTERNAL_ERROR", message: "Erro interno" };
const UNAVAILABLE: HttpError = {
  status: 503,
  code: "DATABASE_UNAVAILABLE",
  message: "Serviço indisponível no momento. Tente de novo em instantes.",
  headers: { "Retry-After": "5" },
};

// Erros do Prisma que o cliente precisa ver com o status certo (o resto é 500)
function fromPrisma(err: Prisma.PrismaClientKnownRequestError): HttpError {
  switch (err.code) {
    case "P2002": // unique violada
      return { status: 409, code: "ALREADY_EXISTS", message: "Esse registro já existe" };
    case "P2003": // chave estrangeira violada
    case "P2014":
      return { status: 409, code: "RELATION_CONFLICT", message: "Operação conflita com dados relacionados" };
    case "P2025": // registro a alterar/apagar não existe
      return { status: 404, code: "NOT_FOUND", message: "Registro não encontrado" };
    case "P2034": // conflito de escrita / deadlock: tentar de novo resolve
    case "P2024": // sem conexão livre no pool
    case "P1008": // timeout
    case "P1001": // banco inalcançável
    case "P1002":
    case "P1017":
      return { ...UNAVAILABLE, headers: { "Retry-After": "1" } };
    default:
      return INTERNAL;
  }
}

// Erros do body-parser do Express (JSON quebrado, corpo grande demais...) trazem `type`
function fromBodyParser(err: { type?: unknown }): HttpError | null {
  switch (err.type) {
    case "entity.parse.failed":
      return { status: 400, code: "INVALID_JSON", message: "O corpo da requisição não é um JSON válido" };
    case "entity.too.large":
      return { status: 413, code: "PAYLOAD_TOO_LARGE", message: "O corpo da requisição é grande demais" };
    case "charset.unsupported":
    case "encoding.unsupported":
      return { status: 415, code: "UNSUPPORTED_MEDIA_TYPE", message: "Formato da requisição não suportado" };
    default:
      return null;
  }
}

// Traduz qualquer coisa lançada para a resposta HTTP. Tudo o que não for reconhecido vira 500 genérico:
// a mensagem interna (que pode vazar detalhes de banco ou de código) fica só no log.
export function toHttpError(err: unknown): HttpError {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details, headers: err.headers };
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      code: "VALIDATION_ERROR",
      message: err.issues[0]?.message ?? "Dados inválidos", // o front mostra esta mensagem ao jogador
      details: issueDetails(err),
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) return fromPrisma(err);
  if (err instanceof Prisma.PrismaClientInitializationError) return UNAVAILABLE;
  if (typeof err === "object" && err !== null) {
    const parsed = fromBodyParser(err);
    if (parsed) return parsed;
  }
  return INTERNAL;
}

// Último middleware do app: a única porta de saída de erro da API
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err); // a resposta já começou: deixa o Express encerrar a conexão

  const { status, code, message, details, headers } = toHttpError(err);
  const requestId: string | undefined = res.locals.requestId;

  // 4xx é erro do cliente (esperado); só 5xx merece log com stack
  if (status >= 500) console.error(`[${requestId}] ${req.method} ${req.originalUrl} -> ${status}`, err);

  if (headers) res.set(headers);
  // `error` segue sendo a mensagem em texto (é só isso que o front lê); o resto é para quem quiser tratar
  res.status(status).json({ error: message, code, ...(details !== undefined && { details }), requestId });
};
