import type { Avatar } from "./avatar";

// Linha do usuário como vem do banco (só os campos que o front pode ver)
type UserRow = {
  id: string;
  email: string;
  displayName: string;
  avatarSkin: string;
  avatarFace: string;
  avatarEyes: string;
  avatarHair: string;
  avatarHairColor: string;
  avatarHat: string;
  avatarBeard: string;
  avatarOutfit: string;
};

// O que o front pode saber do usuário (nunca o hash da senha)
export const toPublicUser = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  avatar: {
    skin: u.avatarSkin,
    eyes: u.avatarEyes,
    face: u.avatarFace,
    hair: u.avatarHair,
    hairColor: u.avatarHairColor,
    beard: u.avatarBeard,
    hat: u.avatarHat,
    outfit: u.avatarOutfit,
  } as Avatar,
});

export type PublicUser = ReturnType<typeof toPublicUser>;
