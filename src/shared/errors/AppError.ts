// Erro esperado, com o status HTTP e um code estável (o front pode decidir por ele; a mensagem vai para o jogador).
// Os services lançam as subclasses; o errorHandler (shared/http) é o único lugar que vira resposta HTTP.
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

// 400: o pedido em si está errado (formato, referência a algo que não existe, código de reset errado)
export class BadRequestError extends AppError {
  constructor(message: string, code = "BAD_REQUEST", details?: unknown) {
    super(400, code, message, details);
  }
}

// 401: sem sessão válida ou credenciais erradas
export class UnauthorizedError extends AppError {
  constructor(message = "Não autenticado", code = "UNAUTHENTICATED") {
    super(401, code, message);
  }
}

// 403: autenticado, mas sem permissão
export class ForbiddenError extends AppError {
  constructor(message = "Sem permissão", code = "FORBIDDEN") {
    super(403, code, message);
  }
}

// 404: o recurso (terreno, árvore, rota...) não existe
export class NotFoundError extends AppError {
  constructor(message = "Não encontrado", code = "NOT_FOUND") {
    super(404, code, message);
  }
}

// 409: o pedido conflita com o estado atual (já existe, já foi feito)
export class ConflictError extends AppError {
  constructor(message: string, code = "CONFLICT") {
    super(409, code, message);
  }
}

// 422: o pedido é válido, mas uma regra do negócio/jogo não deixa (sem dinheiro, planta verde...)
export class UnprocessableError extends AppError {
  constructor(message: string, code = "UNPROCESSABLE") {
    super(422, code, message);
  }
}

// 429: passou do limite de requisições; retryAfterSeconds vai no cabeçalho Retry-After
export class TooManyRequestsError extends AppError {
  constructor(retryAfterSeconds: number, message = "Muitas tentativas. Aguarde um pouco e tente de novo.") {
    super(429, "TOO_MANY_REQUESTS", message, undefined, { "Retry-After": String(retryAfterSeconds) });
  }
}
