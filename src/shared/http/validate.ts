import type { RequestHandler } from "express";
import { ZodError, type ZodType } from "zod";
import { BadRequestError } from "../errors/AppError";

// Lista de problemas no formato que a API devolve em `details`
export const issueDetails = (err: ZodError) => err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));

type Schemas = {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
  // Mensagem para o jogador quando algo é inválido. Sem ela, vale a primeira mensagem do próprio schema
  // (bom quando o schema tem mensagens escritas à mão, como no cadastro).
  message?: string;
};

// Valida o corpo, os parâmetros da rota e/ou a query, e troca pelo valor já tratado (trim, lowercase...).
// Inválido: responde 400 VALIDATION_ERROR com os detalhes de cada campo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validate(schemas: Schemas): RequestHandler<any, any, any, any> {
  return (req, _res, next) => {
    try {
      // sem corpo (ou com Content-Type diferente de JSON) o req.body vem undefined
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      // req.query é só um getter no Express: para trocar o valor, redefine a propriedade
      if (schemas.query) Object.defineProperty(req, "query", { value: schemas.query.parse(req.query), configurable: true });
      next();
    } catch (err) {
      if (err instanceof ZodError && schemas.message) {
        return next(new BadRequestError(schemas.message, "VALIDATION_ERROR", issueDetails(err)));
      }
      next(err);
    }
  };
}
