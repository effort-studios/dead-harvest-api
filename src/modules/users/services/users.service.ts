import { avatarColumns, toPublicUser } from "../entities/public-user";
import type { UpdateProfileInput } from "../dto/users.dto";
import * as userRepository from "../repositories/user.repository";

// Muda o nome e/ou o avatar. Os ids das peças já chegam validados pelo DTO (e o banco confere de novo, com CHECK).
export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const user = await userRepository.updateProfile(userId, {
    displayName: input.displayName,
    ...(input.avatar && avatarColumns(input.avatar)),
  });
  return toPublicUser(user);
}
