import type { NextFunction, Request, RequestHandler, Response } from "express";

// O Express 4 não captura a rejeição de handlers async: sem isto, um throw viraria requisição pendurada.
// Com isto, qualquer erro cai no errorHandler, e os controllers ficam sem try/catch.
export function asyncHandler<P = Record<string, string>, B = unknown>(
  handler: (req: Request<P, unknown, B>, res: Response) => Promise<void>,
): RequestHandler<P, unknown, B> {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}
