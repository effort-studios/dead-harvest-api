import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from "../../../src/shared/errors/AppError";

vi.mock("../../../src/modules/users/repositories/user.repository");
vi.mock("../../../src/modules/auth/repositories/session.repository");
vi.mock("../../../src/modules/auth/repositories/password-reset.repository");
vi.mock("../../../src/modules/auth/repositories/email-verification.repository");
vi.mock("../../../src/modules/auth/utils/mailer");

import * as emailVerifications from "../../../src/modules/auth/repositories/email-verification.repository";
import * as passwordResets from "../../../src/modules/auth/repositories/password-reset.repository";
import * as sessions from "../../../src/modules/auth/repositories/session.repository";
import * as auth from "../../../src/modules/auth/services/auth.service";
import { hashPassword } from "../../../src/modules/auth/utils/password";
import { sendEmailVerificationCode, sendPasswordResetCode } from "../../../src/modules/auth/utils/mailer";
import { hmac, sha256 } from "../../../src/modules/auth/utils/tokens";
import * as userRepository from "../../../src/modules/users/repositories/user.repository";

const users = vi.mocked(userRepository);
const sessionRepo = vi.mocked(sessions);
const resets = vi.mocked(passwordResets);
const verifications = vi.mocked(emailVerifications);

const userRow = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: "11111111-1111-1111-1111-111111111111",
    email: "ana@example.test",
    passwordHash: "hash-secreto",
    displayName: "Ana",
    avatarSkin: "light",
    avatarFace: "happy",
    avatarEyes: "green",
    avatarHair: "short",
    avatarHairColor: "brown",
    avatarHat: "straw",
    avatarBeard: "none",
    avatarOutfit: "overalls_blue",
    emailVerifiedAt: new Date(),
    ...over,
  }) as Awaited<ReturnType<typeof userRepository.findByEmail>> & object;

const uniqueViolation = () => new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" });

beforeEach(() => {
  vi.resetAllMocks();
  sessionRepo.create.mockResolvedValue({} as never);
});

describe("register", () => {
  it("cria o usuário com o save inicial e devolve só o usuário público (sem hash de senha e SEM sessão)", async () => {
    users.createWithSave.mockResolvedValue(userRow({ emailVerifiedAt: null }));
    const result = await auth.register({ email: "ana@example.test", password: "senha-1234", displayName: "Ana" });

    const created = users.createWithSave.mock.calls[0][0];
    expect(created.email).toBe("ana@example.test");
    expect(created.passwordHash).toMatch(/^scrypt\$/); // nunca a senha em claro
    expect(created.save.plots).toEqual([{ x: 0, y: 0 }]);
    expect(created.save.inventory.length).toBeGreaterThan(0);

    expect(JSON.stringify(result.user)).not.toContain("hash-secreto");
    expect(result.user.avatar.hat).toBe("straw");
    expect(result).not.toHaveProperty("session");
    expect(sessionRepo.create).not.toHaveBeenCalled();
  });

  it("envia o código de confirmação: 6 dígitos, só o HMAC fica guardado", async () => {
    users.createWithSave.mockResolvedValue(userRow({ emailVerifiedAt: null }));
    await auth.register({ email: "ana@example.test", password: "senha-1234", displayName: "Ana" });

    const [email, code] = vi.mocked(sendEmailVerificationCode).mock.calls[0];
    expect(email).toBe("ana@example.test");
    expect(code).toMatch(/^\d{6}$/);
    const [userId, codeHash, expiresAt] = verifications.replaceCode.mock.calls[0];
    expect(codeHash).toBe(hmac(`${userId}:${code}`));
    expect(JSON.stringify(verifications.replaceCode.mock.calls[0])).not.toContain(`"${code}"`);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("falha ao enviar o e-mail não derruba o cadastro (a conta existe; o jogador pede outro código)", async () => {
    users.createWithSave.mockResolvedValue(userRow({ emailVerifiedAt: null }));
    vi.mocked(sendEmailVerificationCode).mockRejectedValue(new Error("resend fora do ar"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(auth.register({ email: "ana@example.test", password: "senha-1234", displayName: "Ana" })).resolves.toHaveProperty("user");
  });

  it("e-mail repetido (P2002) vira ConflictError EMAIL_TAKEN", async () => {
    users.createWithSave.mockRejectedValue(uniqueViolation());
    await expect(auth.register({ email: "a@a.test", password: "senha-1234", displayName: "Ana" })).rejects.toMatchObject({
      constructor: ConflictError,
      status: 409,
      code: "EMAIL_TAKEN",
    });
  });

  it("outro erro do banco não é mascarado", async () => {
    const boom = new Error("conexão caiu");
    users.createWithSave.mockRejectedValue(boom);
    await expect(auth.register({ email: "a@a.test", password: "senha-1234", displayName: "Ana" })).rejects.toBe(boom);
  });
});

describe("login", () => {
  it("senha certa: devolve usuário e sessão e atualiza o último login", async () => {
    users.findByEmail.mockResolvedValue(userRow({ passwordHash: await hashPassword("senha-1234") }));
    const { user } = await auth.login({ email: "ana@example.test", password: "senha-1234" });
    expect(user.email).toBe("ana@example.test");
    expect(users.touchLastLogin).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
    expect(sessionRepo.create).toHaveBeenCalledOnce();
  });

  it("e-mail ainda não confirmado: 403 EMAIL_NOT_VERIFIED (só para quem acertou a senha), sem sessão", async () => {
    users.findByEmail.mockResolvedValue(userRow({ passwordHash: await hashPassword("senha-1234"), emailVerifiedAt: null }));
    await expect(auth.login({ email: "ana@example.test", password: "senha-1234" })).rejects.toMatchObject({
      constructor: ForbiddenError,
      status: 403,
      code: "EMAIL_NOT_VERIFIED",
    });
    expect(sessionRepo.create).not.toHaveBeenCalled();
    expect(users.touchLastLogin).not.toHaveBeenCalled();
  });

  it("senha errada numa conta não confirmada: 401 (não revela que a conta existe)", async () => {
    users.findByEmail.mockResolvedValue(userRow({ passwordHash: await hashPassword("senha-1234"), emailVerifiedAt: null }));
    await expect(auth.login({ email: "ana@example.test", password: "errada-123" })).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
  });

  it("senha errada: 401 INVALID_CREDENTIALS, sem sessão e sem atualizar login", async () => {
    users.findByEmail.mockResolvedValue(userRow({ passwordHash: await hashPassword("senha-1234") }));
    await expect(auth.login({ email: "ana@example.test", password: "errada-123" })).rejects.toMatchObject({
      constructor: UnauthorizedError,
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
    expect(sessionRepo.create).not.toHaveBeenCalled();
    expect(users.touchLastLogin).not.toHaveBeenCalled();
  });

  it("e-mail inexistente: mesmo erro (não revela se a conta existe)", async () => {
    users.findByEmail.mockResolvedValue(null);
    const err = await auth.login({ email: "x@x.test", password: "senha-1234" }).catch((e) => e);
    expect(err).toMatchObject({ status: 401, code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos" });
  });
});

describe("userFromSession / logout", () => {
  const session = (expiresAt: Date) => ({ expiresAt, user: userRow() }) as never;

  it("sessão válida devolve o usuário público", async () => {
    sessionRepo.findByTokenHash.mockResolvedValue(session(new Date(Date.now() + 60_000)));
    const user = await auth.userFromSession("tok");
    expect(sessionRepo.findByTokenHash).toHaveBeenCalledWith(sha256("tok"));
    expect(user?.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(JSON.stringify(user)).not.toContain("hash-secreto");
  });

  it("sessão vencida ou inexistente devolve null", async () => {
    sessionRepo.findByTokenHash.mockResolvedValue(session(new Date(Date.now() - 1)));
    expect(await auth.userFromSession("tok")).toBeNull();
    sessionRepo.findByTokenHash.mockResolvedValue(null);
    expect(await auth.userFromSession("tok")).toBeNull();
  });

  it("logout apaga pelo hash do token", async () => {
    await auth.logout("tok");
    expect(sessionRepo.deleteByTokenHash).toHaveBeenCalledWith(sha256("tok"));
  });
});

describe("requestPasswordReset", () => {
  it("e-mail inexistente: termina sem erro e sem enviar nada", async () => {
    users.findByEmail.mockResolvedValue(null);
    await expect(auth.requestPasswordReset("x@x.test")).resolves.toBeUndefined();
    expect(resets.replaceCode).not.toHaveBeenCalled();
    expect(sendPasswordResetCode).not.toHaveBeenCalled();
  });

  it("pedido dentro do cooldown de 1 minuto é ignorado em silêncio", async () => {
    users.findByEmail.mockResolvedValue(userRow());
    resets.findLatest.mockResolvedValue({ createdAt: new Date(Date.now() - 10_000) } as never);
    await auth.requestPasswordReset("ana@example.test");
    expect(resets.replaceCode).not.toHaveBeenCalled();
    expect(sendPasswordResetCode).not.toHaveBeenCalled();
  });

  it("gera código de 6 dígitos, guarda só o HMAC e envia o código por e-mail", async () => {
    users.findByEmail.mockResolvedValue(userRow());
    resets.findLatest.mockResolvedValue(null);
    await auth.requestPasswordReset("ana@example.test");

    const [email, code] = vi.mocked(sendPasswordResetCode).mock.calls[0];
    expect(email).toBe("ana@example.test");
    expect(code).toMatch(/^\d{6}$/);
    const [userId, codeHash, expiresAt] = resets.replaceCode.mock.calls[0];
    expect(codeHash).toBe(hmac(`${userId}:${code}`));
    expect(JSON.stringify(resets.replaceCode.mock.calls[0])).not.toContain(`"${code}"`);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("pedido antigo (fora do cooldown) não bloqueia um novo", async () => {
    users.findByEmail.mockResolvedValue(userRow());
    resets.findLatest.mockResolvedValue({ createdAt: new Date(Date.now() - 61_000) } as never);
    await auth.requestPasswordReset("ana@example.test");
    expect(resets.replaceCode).toHaveBeenCalledOnce();
  });
});

describe("resetPassword", () => {
  const input = { email: "ana@example.test", code: "123456", newPassword: "nova-senha-1" };
  const usable = (code = "123456") => ({ id: "reset-1", codeHash: hmac(`11111111-1111-1111-1111-111111111111:${code}`) }) as never;

  it("e-mail inexistente: 400 INVALID_RESET_CODE", async () => {
    users.findByEmail.mockResolvedValue(null);
    await expect(auth.resetPassword(input)).rejects.toMatchObject({ constructor: BadRequestError, status: 400, code: "INVALID_RESET_CODE" });
  });

  it("sem pedido utilizável (vencido, usado ou sem tentativas): o mesmo 400", async () => {
    users.findByEmail.mockResolvedValue(userRow());
    resets.findUsable.mockResolvedValue(null);
    await expect(auth.resetPassword(input)).rejects.toMatchObject({ status: 400, code: "INVALID_RESET_CODE" });
    expect(resets.completeReset).not.toHaveBeenCalled();
  });

  it("código errado: conta a tentativa e responde o mesmo 400", async () => {
    users.findByEmail.mockResolvedValue(userRow());
    resets.findUsable.mockResolvedValue(usable("999999"));
    await expect(auth.resetPassword(input)).rejects.toMatchObject({ status: 400, code: "INVALID_RESET_CODE" });
    expect(resets.incrementAttempts).toHaveBeenCalledWith("reset-1");
    expect(resets.completeReset).not.toHaveBeenCalled();
  });

  it("código certo: troca a senha (só o hash vai ao repositório)", async () => {
    users.findByEmail.mockResolvedValue(userRow());
    resets.findUsable.mockResolvedValue(usable());
    await auth.resetPassword(input);
    const [userId, passwordHash] = resets.completeReset.mock.calls[0];
    expect(userId).toBe("11111111-1111-1111-1111-111111111111");
    expect(passwordHash).toMatch(/^scrypt\$/);
    expect(passwordHash).not.toContain("nova-senha-1");
    expect(resets.incrementAttempts).not.toHaveBeenCalled();
  });
});

describe("resendEmailVerification", () => {
  it("e-mail inexistente ou já confirmado: termina sem erro e sem enviar nada", async () => {
    users.findByEmail.mockResolvedValue(null);
    await expect(auth.resendEmailVerification("x@x.test")).resolves.toBeUndefined();
    users.findByEmail.mockResolvedValue(userRow());
    await expect(auth.resendEmailVerification("ana@example.test")).resolves.toBeUndefined();
    expect(verifications.replaceCode).not.toHaveBeenCalled();
    expect(sendEmailVerificationCode).not.toHaveBeenCalled();
  });

  it("pedido dentro do cooldown de 1 minuto é ignorado em silêncio", async () => {
    users.findByEmail.mockResolvedValue(userRow({ emailVerifiedAt: null }));
    verifications.findLatest.mockResolvedValue({ createdAt: new Date(Date.now() - 10_000) } as never);
    await auth.resendEmailVerification("ana@example.test");
    expect(sendEmailVerificationCode).not.toHaveBeenCalled();
  });

  it("conta não confirmada fora do cooldown: gera e envia um código novo", async () => {
    users.findByEmail.mockResolvedValue(userRow({ emailVerifiedAt: null }));
    verifications.findLatest.mockResolvedValue({ createdAt: new Date(Date.now() - 61_000) } as never);
    await auth.resendEmailVerification("ana@example.test");
    expect(verifications.replaceCode).toHaveBeenCalledOnce();
    expect(vi.mocked(sendEmailVerificationCode).mock.calls[0][1]).toMatch(/^\d{6}$/);
  });
});

describe("verifyEmail", () => {
  const input = { email: "ana@example.test", code: "123456" };
  const unverified = () => userRow({ emailVerifiedAt: null });
  const usable = (code = "123456") => ({ id: "ver-1", codeHash: hmac(`11111111-1111-1111-1111-111111111111:${code}`) }) as never;

  it("e-mail inexistente ou já confirmado: 400 INVALID_VERIFICATION_CODE", async () => {
    users.findByEmail.mockResolvedValue(null);
    await expect(auth.verifyEmail(input)).rejects.toMatchObject({ constructor: BadRequestError, status: 400, code: "INVALID_VERIFICATION_CODE" });
    users.findByEmail.mockResolvedValue(userRow());
    await expect(auth.verifyEmail(input)).rejects.toMatchObject({ status: 400, code: "INVALID_VERIFICATION_CODE" });
  });

  it("sem pedido utilizável (vencido, usado ou sem tentativas): o mesmo 400", async () => {
    users.findByEmail.mockResolvedValue(unverified());
    verifications.findUsable.mockResolvedValue(null);
    await expect(auth.verifyEmail(input)).rejects.toMatchObject({ status: 400, code: "INVALID_VERIFICATION_CODE" });
    expect(verifications.completeVerification).not.toHaveBeenCalled();
  });

  it("código errado: conta a tentativa, não confirma e não cria sessão", async () => {
    users.findByEmail.mockResolvedValue(unverified());
    verifications.findUsable.mockResolvedValue(usable("999999"));
    await expect(auth.verifyEmail(input)).rejects.toMatchObject({ status: 400, code: "INVALID_VERIFICATION_CODE" });
    expect(verifications.incrementAttempts).toHaveBeenCalledWith("ver-1");
    expect(verifications.completeVerification).not.toHaveBeenCalled();
    expect(sessionRepo.create).not.toHaveBeenCalled();
  });

  it("código certo: confirma o e-mail e abre a sessão (só o hash do token é guardado)", async () => {
    users.findByEmail.mockResolvedValue(unverified());
    verifications.findUsable.mockResolvedValue(usable());
    const { user, session } = await auth.verifyEmail(input, "jest-agent");

    expect(verifications.completeVerification).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
    expect(user.email).toBe("ana@example.test");
    expect(session.token.length).toBeGreaterThanOrEqual(43);
    const saved = sessionRepo.create.mock.calls[0][0];
    expect(saved.tokenHash).toBe(sha256(session.token));
    expect(JSON.stringify(saved)).not.toContain(session.token);
    expect(verifications.incrementAttempts).not.toHaveBeenCalled();
  });
});
