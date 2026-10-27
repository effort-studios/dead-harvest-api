-- Valores novos dos enums numa migration só deles: o Postgres não deixa usar um valor de enum na mesma
-- transação em que ele foi criado, e a migration seguinte (machines_barn) já insere itens e regras com eles.

-- Itens: colheita das plantas (armazém), produtos dos animais e das máquinas
ALTER TYPE "item_kind" ADD VALUE 'crop';
ALTER TYPE "item_kind" ADD VALUE 'animal_product';
ALTER TYPE "item_kind" ADD VALUE 'product';

-- Tarefas do fazendeiro: adubar um tile, coletar uma máquina, coletar o celeiro
ALTER TYPE "job_action" ADD VALUE 'fertilize';
ALTER TYPE "job_action" ADD VALUE 'collect_machine';
ALTER TYPE "job_action" ADD VALUE 'collect_barn';
