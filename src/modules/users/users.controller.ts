import { currentUser } from "../auth/auth.middleware";
import { asyncHandler } from "../../shared/http/asyncHandler";
import type { UpdateProfileInput } from "./users.schemas";
import * as users from "./users.service";

// Edita o próprio perfil (nome e/ou avatar)
export const updateProfile = asyncHandler<Record<string, string>, UpdateProfileInput>(async (req, res) => {
  res.json({ user: await users.updateProfile(currentUser(res).id, req.body) });
});
