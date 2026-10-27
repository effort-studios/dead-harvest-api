-- Valor novo do enum numa migration só dele (o Postgres não deixa usar um valor de enum na mesma transação
-- em que ele foi criado; a migration seguinte, untill_job_target, já usa no CHECK da fila)

-- Tarefa do fazendeiro: desfazer a aragem (o tile arado e vazio volta a ser terra)
ALTER TYPE "job_action" ADD VALUE 'untill';
