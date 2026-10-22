-- Avatar: tira o chapéu de flor e a camisa amarela (não terão desenho). Quem estava com eles
-- volta para o padrão (chapéu de palha, macacão azul).

UPDATE "users" SET "avatar_hat" = 'straw' WHERE "avatar_hat" = 'flower';
UPDATE "users" SET "avatar_outfit" = 'overalls_blue' WHERE "avatar_outfit" = 'shirt_yellow';

ALTER TABLE "users" DROP CONSTRAINT "users_avatar_hat_check";
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_hat_check" CHECK ("avatar_hat" IN ('none', 'straw', 'cap', 'beanie', 'cowboy'));
ALTER TABLE "users" DROP CONSTRAINT "users_avatar_outfit_check";
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_outfit_check" CHECK ("avatar_outfit" IN ('overalls_blue', 'overalls_red', 'shirt_green', 'shirt_purple', 'coat_brown'));
