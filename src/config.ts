import "dotenv/config";

// Falha logo na inicialização se faltar alguma variável, em vez de dar erro estranho depois
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ${name} não definida (veja .env.example)`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3333),
  webUrl: required("WEB_URL"),
};
