import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./tests/setup/test-db";

// Variáveis que o config.ts exige; valem só nos testes (o dotenv não sobrescreve o que já está definido)
const env = {
  NODE_ENV: "test",
  DATABASE_URL: testDatabaseUrl(),
  WEB_URL: "http://localhost:5173",
  AUTH_SECRET: "segredo-de-teste-com-mais-de-32-caracteres",
  DAY_LENGTH_SECONDS: "1440",
};

export default defineConfig({
  test: {
    env,
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/setup/global-setup.ts"],
          fileParallelism: false, // um banco só, compartilhado
          testTimeout: 15_000,
        },
      },
    ],
  },
});
