-- Avatar: cor dos olhos, estilo e cor do cabelo. Quem já tem conta fica com o visual de antes
-- (olhos verdes, cabelo curto castanho).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_eyes" TEXT NOT NULL DEFAULT 'green',
ADD COLUMN     "avatar_hair" TEXT NOT NULL DEFAULT 'short',
ADD COLUMN     "avatar_hair_color" TEXT NOT NULL DEFAULT 'brown';


ALTER TABLE "users" ADD CONSTRAINT "users_avatar_eyes_check" CHECK ("avatar_eyes" IN ('brown', 'green', 'blue', 'gray', 'hazel'));
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_hair_check" CHECK ("avatar_hair" IN ('short', 'messy', 'long', 'ponytail', 'bun', 'buzz', 'bald'));
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_hair_color_check" CHECK ("avatar_hair_color" IN ('black', 'brown', 'auburn', 'ginger', 'blonde', 'gray'));
