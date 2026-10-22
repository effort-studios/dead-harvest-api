import type { Request, RequestHandler } from "express";

// Limite de requisições em janela fixa, na memória do processo (suficiente para uma API de uma instância).
// `key` define quem está sendo contado; passou de `max` dentro da janela, 429.
export function rateLimit(options: { windowMs: number; max: number; key?: (req: Request) => string }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  // limpa entradas vencidas de tempos em tempos, para o mapa não crescer para sempre
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, options.windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = options.key?.(req) ?? req.ip ?? "unknown";
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > options.max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: "Muitas tentativas. Aguarde um pouco e tente de novo." });
    }
    next();
  };
}
