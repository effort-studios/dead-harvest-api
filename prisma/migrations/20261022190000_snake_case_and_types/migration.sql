-- Padroniza o banco: tabelas no plural e colunas em snake_case, ids como uuid, datas com fuso.
-- Tudo é RENAME / ALTER TYPE com USING, então os dados existentes são preservados.
-- (Um DROP + CREATE, que é o que o Prisma geraria sozinho, apagaria o progresso dos jogadores.)

-- Tabelas
ALTER TABLE "Player" RENAME TO "users";
ALTER TABLE "Save" RENAME TO "saves";

-- Colunas
ALTER TABLE "users" RENAME COLUMN "name" TO "display_name";
ALTER TABLE "users" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "saves" RENAME COLUMN "playerId" TO "user_id";
ALTER TABLE "saves" RENAME COLUMN "updatedAt" TO "updated_at";

-- Constraints e índices (o Prisma espera os nomes novos; sem isso ele acusa drift)
ALTER TABLE "users" RENAME CONSTRAINT "Player_pkey" TO "users_pkey";
ALTER TABLE "saves" RENAME CONSTRAINT "Save_pkey" TO "saves_pkey";
ALTER INDEX "Save_playerId_key" RENAME TO "saves_user_id_key";

-- Tipos: TEXT -> uuid. A chave estrangeira sai e volta, porque os dois lados mudam de tipo.
ALTER TABLE "saves" DROP CONSTRAINT "Save_playerId_fkey";
ALTER TABLE "users" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "saves" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "saves" ALTER COLUMN "user_id" TYPE UUID USING "user_id"::uuid;
ALTER TABLE "saves"
  ADD CONSTRAINT "saves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Datas: o Prisma sempre gravou em UTC, então é só declarar o fuso
ALTER TABLE "users" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "saves" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- Regras que o banco passa a garantir (antes só o Zod da API garantia)
ALTER TABLE "saves" ADD CONSTRAINT "saves_money_check" CHECK ("money" >= 0);
ALTER TABLE "saves" ADD CONSTRAINT "saves_day_check" CHECK ("day" >= 1);
ALTER TABLE "saves" ADD CONSTRAINT "saves_time_check" CHECK ("time" >= 0);
