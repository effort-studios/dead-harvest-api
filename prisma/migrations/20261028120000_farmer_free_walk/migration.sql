-- Andar livre: quando o cliente avisou a última posição (o servidor confere a velocidade por esse horário)
ALTER TABLE "saves" ADD COLUMN "farmer_moved_at" TIMESTAMPTZ(3);
