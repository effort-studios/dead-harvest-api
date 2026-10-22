// Peças do avatar. O front desenha cada uma pelo id; o servidor só aceita ids que existem aqui
// (e o banco também confere, com CHECK). Para adicionar uma peça: incluir o id aqui, no CHECK
// (nova migration) e no desenho do front.
export const AVATAR_OPTIONS = {
  skin: ["porcelain", "light", "tan", "olive", "brown", "dark"],
  eyes: ["brown", "green", "blue", "gray", "hazel"],
  face: ["happy", "calm", "wink", "surprised", "sleepy"],
  hair: ["short", "messy", "long", "ponytail", "bun", "buzz", "bald"],
  hairColor: ["black", "brown", "auburn", "ginger", "blonde", "gray"],
  beard: ["none", "stubble", "mustache", "goatee", "full"],
  hat: ["none", "straw", "cap", "beanie", "cowboy"],
  outfit: ["overalls_blue", "overalls_red", "shirt_green", "shirt_purple", "coat_brown"],
} as const;

export type AvatarPart = keyof typeof AVATAR_OPTIONS;

export type Avatar = { [K in AvatarPart]: (typeof AVATAR_OPTIONS)[K][number] };

// Avatar de quem acabou de criar a conta (o fazendeiro de chapéu de palha)
export const DEFAULT_AVATAR: Avatar = {
  skin: "light",
  eyes: "green",
  face: "happy",
  hair: "short",
  hairColor: "brown",
  beard: "none",
  hat: "straw",
  outfit: "overalls_blue",
};
