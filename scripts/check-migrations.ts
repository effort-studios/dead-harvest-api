import "dotenv/config";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

// Confere se as migrations geram exatamente o schema.prisma (pega schema alterado sem migration).
// O Prisma precisa de um banco descartável para isso: usa {banco de desenvolvimento}_shadow, no mesmo Postgres.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definida (veja .env.example)");

const name = `${decodeURIComponent(new URL(url).pathname.slice(1))}_shadow`;
const shadowUrl = new URL(url);
shadowUrl.pathname = `/${name}`;
const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";

async function main() {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    const found = await admin.$queryRaw<{ one: number }[]>`SELECT 1 AS one FROM pg_database WHERE datname = ${name}`;
    // CREATE DATABASE não aceita parâmetro; as aspas duplas cobrem o nome
    if (found.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${name.replace(/"/g, "")}"`);
  } finally {
    await admin.$disconnect();
  }

  execFileSync(
    "npx",
    [
      "prisma", "migrate", "diff",
      "--from-migrations", "prisma/migrations",
      "--to-schema-datamodel", "prisma/schema.prisma",
      "--shadow-database-url", shadowUrl.toString(),
      "--exit-code",
    ],
    { stdio: "inherit", shell: process.platform === "win32" }, // no Windows o npx é um .cmd
  );
}

main().catch(() => {
  console.error("\nschema.prisma e prisma/migrations não batem: crie a migration com `npm run migrate`.");
  process.exit(1);
});
