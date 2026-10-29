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
  webOrigins: required("WEB_URL")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean),
  // segredo usado para assinar (HMAC) os códigos de redefinição de senha; mínimo de 32 caracteres
  authSecret: (() => {
    const secret = required("AUTH_SECRET");
    if (secret.length < 32) throw new Error("AUTH_SECRET precisa ter pelo menos 32 caracteres");
    return secret;
  })(),
  // duração de um dia inteiro do jogo, em segundos (o relógio do jogo cobre 24h nesse tempo)
  dayLengthSeconds: (() => {
    const seconds = Number(process.env.DAY_LENGTH_SECONDS ?? 1440);
    if (!Number.isInteger(seconds) || seconds < 60) throw new Error("DAY_LENGTH_SECONDS precisa ser um inteiro >= 60");
    return seconds;
  })(),
  // instante em que o dia 1 do mundo começou (meia-noite): o relógio do jogo é o mesmo para todos os jogadores
  worldEpoch: (() => {
    const ms = Date.parse(process.env.WORLD_EPOCH ?? "2026-10-27T00:00:00Z");
    if (Number.isNaN(ms)) throw new Error("WORLD_EPOCH precisa ser uma data ISO válida");
    return ms;
  })(),
  // SameSite do cookie de sessão. "lax" serve quando front e API estão no mesmo site (domínio próprio);
  // com front e API em subdomínios diferentes de up.railway.app use "none" (exige HTTPS)
  cookieSameSite: ((): "lax" | "strict" | "none" => {
    const value = process.env.COOKIE_SAMESITE ?? "lax";
    if (value !== "lax" && value !== "strict" && value !== "none") throw new Error("COOKIE_SAMESITE precisa ser lax, strict ou none");
    return value;
  })(),
  // Fazendeiro: velocidade (células por segundo) e duração do gesto (ms). Os tempos de cada pedido da fila
  // saem destes valores; os testes usam 0 de gesto e velocidade enorme para a fila andar na hora
  farmerWalkSpeed: Number(process.env.FARMER_WALK_SPEED ?? 3.4),
  farmerActMs: Number(process.env.FARMER_ACT_MS ?? 550),
  // envio de e-mail pela Resend; sem a chave, o e-mail só é escrito no log (apenas fora de produção)
  resendApiKey: process.env.RESEND_API_KEY || undefined,
  mailFrom: process.env.MAIL_FROM ?? "Dead Harvest <nao-responda@convx.com.br>",
  sessionDays: 30, // duração do login
  resetCodeMinutes: 15, // validade do código de redefinição
  resetMaxAttempts: 5, // erros de código antes de o pedido ser invalidado
};
