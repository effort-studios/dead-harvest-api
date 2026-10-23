import { z } from "zod";
import { AVATAR_OPTIONS } from "./avatar";

export const displayName = z.string().trim().min(2, "Nome muito curto").max(30, "Nome muito longo");

const avatar = z.object({
  skin: z.enum(AVATAR_OPTIONS.skin),
  face: z.enum(AVATAR_OPTIONS.face),
  eyes: z.enum(AVATAR_OPTIONS.eyes),
  hair: z.enum(AVATAR_OPTIONS.hair),
  hairColor: z.enum(AVATAR_OPTIONS.hairColor),
  hat: z.enum(AVATAR_OPTIONS.hat),
  beard: z.enum(AVATAR_OPTIONS.beard),
  outfit: z.enum(AVATAR_OPTIONS.outfit),
});

export const updateProfileBody = z.object({ displayName: displayName.optional(), avatar: avatar.optional() });

export type UpdateProfileInput = z.infer<typeof updateProfileBody>;
