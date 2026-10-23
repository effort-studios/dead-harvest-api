import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/modules/users/repositories/user.repository");

import * as userRepository from "../../../src/modules/users/repositories/user.repository";
import { updateProfile } from "../../../src/modules/users/services/users.service";

const repo = vi.mocked(userRepository);

const row = {
  id: "u1",
  email: "ana@example.test",
  passwordHash: "hash-secreto",
  displayName: "Novo",
  avatarSkin: "dark",
  avatarFace: "calm",
  avatarEyes: "blue",
  avatarHair: "long",
  avatarHairColor: "black",
  avatarHat: "none",
  avatarBeard: "none",
  avatarOutfit: "shirt_green",
};

const avatar = { skin: "dark", face: "calm", eyes: "blue", hair: "long", hairColor: "black", hat: "none", beard: "none", outfit: "shirt_green" } as const;

beforeEach(() => {
  vi.resetAllMocks();
  repo.updateProfile.mockResolvedValue(row as never);
});

describe("updateProfile", () => {
  it("só o nome: não manda nenhuma coluna de avatar", async () => {
    await updateProfile("u1", { displayName: "Novo" });
    expect(repo.updateProfile).toHaveBeenCalledWith("u1", { displayName: "Novo" });
  });

  it("avatar: manda cada peça na coluna certa", async () => {
    await updateProfile("u1", { avatar });
    expect(repo.updateProfile).toHaveBeenCalledWith("u1", {
      displayName: undefined,
      avatarSkin: "dark",
      avatarFace: "calm",
      avatarEyes: "blue",
      avatarHair: "long",
      avatarHairColor: "black",
      avatarHat: "none",
      avatarBeard: "none",
      avatarOutfit: "shirt_green",
    });
  });

  it("devolve o usuário público, sem o hash da senha", async () => {
    const user = await updateProfile("u1", { displayName: "Novo" });
    expect(user).toMatchObject({ id: "u1", displayName: "Novo", avatar });
    expect(JSON.stringify(user)).not.toContain("hash-secreto");
  });
});
