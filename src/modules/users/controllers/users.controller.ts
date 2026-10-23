import { asyncHandler } from "../../../shared/http/asyncHandler";
import { currentUser } from "../../auth/middlewares/require-auth";
import type { UpdateProfileInput } from "../dto/users.dto";
import * as users from "../services/users.service";

// Edita o próprio perfil (nome e/ou avatar)
export const updateProfile = asyncHandler<Record<string, string>, UpdateProfileInput>(async (req, res) => {
  res.json({ user: await users.updateProfile(currentUser(res).id, req.body) });
});
