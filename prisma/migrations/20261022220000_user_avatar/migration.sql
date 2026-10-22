-- Avatar do jogador: ids das peças (cor de pele, rosto, chapéu, barba e roupa) direto em users.
-- Os usuários que já existem ficam com o avatar padrão (o fazendeiro de chapéu de palha).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_beard" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "avatar_face" TEXT NOT NULL DEFAULT 'happy',
ADD COLUMN     "avatar_hat" TEXT NOT NULL DEFAULT 'straw',
ADD COLUMN     "avatar_outfit" TEXT NOT NULL DEFAULT 'overalls_blue',
ADD COLUMN     "avatar_skin" TEXT NOT NULL DEFAULT 'light';


-- ---------- Peças aceitas (as mesmas de src/game/avatar.ts) ----------
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_skin_check" CHECK ("avatar_skin" IN ('porcelain', 'light', 'tan', 'olive', 'brown', 'dark'));
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_face_check" CHECK ("avatar_face" IN ('happy', 'calm', 'wink', 'surprised', 'sleepy'));
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_hat_check" CHECK ("avatar_hat" IN ('none', 'straw', 'cap', 'beanie', 'cowboy', 'flower'));
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_beard_check" CHECK ("avatar_beard" IN ('none', 'stubble', 'mustache', 'goatee', 'full'));
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_outfit_check" CHECK ("avatar_outfit" IN ('overalls_blue', 'overalls_red', 'shirt_green', 'shirt_purple', 'coat_brown', 'shirt_yellow'));
