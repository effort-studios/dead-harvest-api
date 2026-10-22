-- Plantas medidas em dias de jogo (com o dia de 24 min: 1 dia = 1440 s) e preços reequilibrados
-- para o ritmo mais lento: semente ~2x, venda ~3x. O lucro por minuto cresce com a planta mais
-- demorada (0,8/min no tomate até 1,2/min na melancia), para compensar a espera.
--
--   planta      dias  tempo   semente  venda  lucro
--   tomate      1     24min   8        27     19
--   cenoura     1,5   36min   10       41     31
--   milho       2     48min   14       57     43
--   batata      2,5   1h      18       75     57
--   morango     3     1h12    24       96     72
--   abóbora     4     1h36    36       142    106
--   melancia    5     2h      56       200    144

UPDATE "crops" SET "grow_seconds" = 1440, "harvest_price" = 27  WHERE "id" = 'tomato';
UPDATE "crops" SET "grow_seconds" = 2160, "harvest_price" = 41  WHERE "id" = 'carrot';
UPDATE "crops" SET "grow_seconds" = 2880, "harvest_price" = 57  WHERE "id" = 'corn';
UPDATE "crops" SET "grow_seconds" = 3600, "harvest_price" = 75  WHERE "id" = 'potato';
UPDATE "crops" SET "grow_seconds" = 4320, "harvest_price" = 96  WHERE "id" = 'strawberry';
UPDATE "crops" SET "grow_seconds" = 5760, "harvest_price" = 142 WHERE "id" = 'pumpkin';
UPDATE "crops" SET "grow_seconds" = 7200, "harvest_price" = 200 WHERE "id" = 'watermelon';

UPDATE "items" SET "buy_price" = 8  WHERE "id" = 'tomato';
UPDATE "items" SET "buy_price" = 10 WHERE "id" = 'carrot';
UPDATE "items" SET "buy_price" = 14 WHERE "id" = 'corn';
UPDATE "items" SET "buy_price" = 18 WHERE "id" = 'potato';
UPDATE "items" SET "buy_price" = 24 WHERE "id" = 'strawberry';
UPDATE "items" SET "buy_price" = 36 WHERE "id" = 'pumpkin';
UPDATE "items" SET "buy_price" = 56 WHERE "id" = 'watermelon';

-- Frutas das árvores acompanham a venda (~3x); a árvore continua repondo em 1h (2,5 dias de jogo)
UPDATE "items" SET "sell_price" = 18 WHERE "id" = 'apple';
UPDATE "items" SET "sell_price" = 24 WHERE "id" = 'orange';
UPDATE "items" SET "sell_price" = 21 WHERE "id" = 'lemon';
