-- Valor novo do enum numa migration só dele (o Postgres não deixa usar um valor de enum na mesma transação
-- em que ele foi criado; a migration seguinte, move_job_target, já usa no CHECK da fila)

-- Tarefa do fazendeiro: só andar até uma célula do mapa, sem agir
ALTER TYPE "job_action" ADD VALUE 'move';
