import "dotenv/config";

// Os testes de integração usam um banco PRÓPRIO ({banco de desenvolvimento}_test, no mesmo Postgres),
// para nunca tocar nos dados de desenvolvimento.
function parse() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida (veja .env.example)");
  const parsed = new URL(url);
  const devName = decodeURIComponent(parsed.pathname.slice(1));
  return { parsed, devName };
}

export function testDatabaseName() {
  const { devName } = parse();
  return devName.endsWith("_test") ? devName : `${devName}_test`;
}

export function testDatabaseUrl() {
  const { parsed } = parse();
  const url = new URL(parsed);
  url.pathname = `/${testDatabaseName()}`;
  return url.toString();
}

// URL do banco de manutenção ("postgres"), de onde se cria o banco de teste
export function adminDatabaseUrl() {
  const { parsed } = parse();
  const url = new URL(parsed);
  url.pathname = "/postgres";
  return url.toString();
}
