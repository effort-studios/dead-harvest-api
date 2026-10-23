import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { adminDatabaseUrl, testDatabaseName, testDatabaseUrl } from "./test-db";

// Roda uma vez antes dos testes de integração: garante que o banco de teste existe e está com as migrations em dia
export default async function setup() {
  const name = testDatabaseName();
  const admin = new PrismaClient({ datasources: { db: { url: adminDatabaseUrl() } } });
  try {
    const found = await admin.$queryRaw<{ one: number }[]>`SELECT 1 AS one FROM pg_database WHERE datname = ${name}`;
    // o nome vem do .env e já passou por new URL; as aspas duplas cobrem o resto (CREATE DATABASE não aceita parâmetro)
    if (found.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${name.replace(/"/g, "")}"`);
  } finally {
    await admin.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
}
