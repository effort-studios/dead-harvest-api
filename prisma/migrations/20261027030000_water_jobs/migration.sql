-- Valores novos do enum numa migration só deles (o Postgres não deixa usar um valor de enum na mesma transação
-- em que ele foi criado; a migration seguinte, watering_can_well, já usa no CHECK da fila)

-- Tarefas do fazendeiro: regar um tile, encher o regador no poço
ALTER TYPE "job_action" ADD VALUE 'water';
ALTER TYPE "job_action" ADD VALUE 'refill_can';
