import { prisma } from "../../shared/database/prisma";
import { toPublicUser } from "./user.mapper";
import type { UpdateProfileInput } from "./users.schemas";

// Muda o nome e/ou o avatar. Os ids das peças já chegam validados (e o banco confere de novo, com CHECK).
// Usuário que não existe mais: o Prisma lança P2025, que o errorHandler responde como 404.
export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      displayName: input.displayName,
      ...(input.avatar && {
        avatarSkin: input.avatar.skin,
        avatarFace: input.avatar.face,
        avatarEyes: input.avatar.eyes,
        avatarHair: input.avatar.hair,
        avatarHairColor: input.avatar.hairColor,
        avatarHat: input.avatar.hat,
        avatarBeard: input.avatar.beard,
        avatarOutfit: input.avatar.outfit,
      }),
    },
  });
  return toPublicUser(user);
}
