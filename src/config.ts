import "dotenv/config";

// Falha logo na inicialização se faltar alguma variável, em vez de dar erro estranho depois
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ${name} não definida (veja .env.example)`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3333),
  isProduction: process.env.NODE_ENV === "production",
  // origens do front liberadas no CORS, separadas por vírgula (ex.: localhost e o IP da rede)
  webOrigins: required("WEB_URL").split(",").map((url) => url.trim()).filter(Boolean),
  // segredo usado para assinar (HMAC) os códigos de redefinição de senha; mínimo de 32 caracteres
  authSecret: (() => {
    const secret = required("AUTH_SECRET");
    if (secret.length < 32) throw new Error("AUTH_SECRET precisa ter pelo menos 32 caracteres");
    return secret;
  })(),
  sessionDays: 30, // duração do login
  resetCodeMinutes: 15, // validade do código de redefinição
  resetMaxAttempts: 5, // erros de código antes de o pedido ser invalidado
};
