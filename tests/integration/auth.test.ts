import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { register } from "../../src/modules/auth/services/auth.service";
import * as emailVerifications from "../../src/modules/auth/repositories/email-verification.repository";
import * as passwordResets from "../../src/modules/auth/repositories/password-reset.repository";
import { hmac } from "../../src/modules/auth/utils/tokens";
import { prisma } from "../../src/shared/database/prisma";
import { as, cleanupTestUsers, createUser, PASSWORD, uniqueEmail } from "../helpers/users";

beforeAll(cleanupTestUsers);
afterAll(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
});

const sessionCookie = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[] | undefined)?.find((c) => c.startsWith("dh_session="));

describe("POST /auth/register", () => {
  it("cria a conta: 201, usuário sem dados secretos e SEM sessão (falta confirmar o e-mail)", async () => {
    const email = uniqueEmail("reg");
    const res = await request(app).post("/auth/register").send({ email, password: PASSWORD, displayName: "Ana" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ emailVerificationRequired: true, user: { email, displayName: "Ana", avatar: { hat: "straw" } } });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/);
    expect(sessionCookie(res)).toBeUndefined();
    expect((await request(app).get("/auth/me")).status).toBe(401);
  });

  it("a conta nasce com o save inicial (1 terreno e sementes), e-mail não confirmado e um código pendente", async () => {
    const email = uniqueEmail("save");
    await request(app).post("/auth/register").send({ email, password: PASSWORD, displayName: "Bia" });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { save: { include: { plots: true, inventory: true } }, sessions: true, emailVerifications: true },
    });
    expect(user.save?.plots).toHaveLength(1);
    expect(user.save?.inventory.length).toBeGreaterThan(0);
    expect(user.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.sessions).toHaveLength(0);
    expect(user.emailVerifications).toHaveLength(1);
    expect(user.emailVerifications[0].codeHash).toMatch(/^[0-9a-f]{64}$/); // HMAC, nunca o código
  });

  it("e-mail repetido: 409 EMAIL_TAKEN (e maiúsculas/espaços não escapam da checagem)", async () => {
    const { email } = await createUser("dup");
    const res = await request(app).post("/auth/register").send({ email: `  ${email.toUpperCase()} `, password: PASSWORD, displayName: "Outra" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "EMAIL_TAKEN", error: "Já existe uma conta com este e-mail" });
  });

  it.each([
    ["e-mail inválido", { email: "nao-e-email", password: PASSWORD, displayName: "Ana" }, "E-mail inválido", "email"],
    ["senha curta", { email: "a@example.test", password: "123", displayName: "Ana" }, "A senha precisa ter pelo menos 8 caracteres", "password"],
    ["nome curto", { email: "a@example.test", password: PASSWORD, displayName: "A" }, "Nome muito curto", "displayName"],
    ["nome longo", { email: "a@example.test", password: PASSWORD, displayName: "x".repeat(31) }, "Nome muito longo", "displayName"],
  ])("%s: 400 com a mensagem do campo", async (_nome, body, message, path) => {
    const res = await request(app).post("/auth/register").send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR", error: message });
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
  });

  it("corpo ausente: 400 (não 500)", async () => {
    expect((await request(app).post("/auth/register")).status).toBe(400);
  });
});

describe("POST /auth/login", () => {
  it("credenciais certas: 200, cookie novo e usuário", async () => {
    const { email } = await createUser("login");
    const res = await request(app).post("/auth/login").send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(sessionCookie(res)).toBeTruthy();
  });

  it("senha errada e e-mail inexistente dão exatamente a mesma resposta 401", async () => {
    const { email } = await createUser("wrongpw");
    const wrong = await request(app).post("/auth/login").send({ email, password: "errada-123" });
    const ghost = await request(app).post("/auth/login").send({ email: uniqueEmail("ghost"), password: "errada-123" });
    for (const res of [wrong, ghost]) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: "E-mail ou senha inválidos", code: "INVALID_CREDENTIALS" });
      expect(sessionCookie(res)).toBeUndefined();
    }
  });

  it("e-mail em maiúsculas entra normalmente", async () => {
    const { email } = await createUser("upper");
    const res = await request(app).post("/auth/login").send({ email: email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("rate limit: da 11ª tentativa em diante (mesmo e-mail) vem 429 com Retry-After", async () => {
    const email = uniqueEmail("limit");
    const statuses: number[] = [];
    let last!: request.Response;
    for (let i = 0; i < 11; i++) {
      last = await request(app).post("/auth/login").send({ email, password: "errada-123" });
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(last.body).toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(Number(last.headers["retry-after"])).toBeGreaterThan(0);

    // outro e-mail não é afetado
    const other = await createUser("limit-other");
    expect((await request(app).post("/auth/login").send({ email: other.email, password: PASSWORD })).status).toBe(200);
  });
});

describe("sessão", () => {
  it("GET /auth/me sem cookie: 401 UNAUTHENTICATED", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "Não autenticado", code: "UNAUTHENTICATED" });
  });

  it("cookie com token que não existe: 401 e o cookie é limpo", async () => {
    const res = await request(app).get("/auth/me").set("Cookie", "dh_session=token-forjado");
    expect(res.status).toBe(401);
    expect(sessionCookie(res)).toMatch(/dh_session=;/);
  });

  it("cookie com escape inválido não derruba a API (401, não 500)", async () => {
    const res = await request(app).get("/auth/me").set("Cookie", "dh_session=%zz");
    expect(res.status).toBe(401);
  });

  it("sessão vencida no banco: 401", async () => {
    const { cookie, user } = await createUser("expired");
    await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await as(cookie).get("/auth/me")).status).toBe(401);
  });

  it("logout: 204, limpa o cookie e a sessão deixa de valer", async () => {
    const { cookie } = await createUser("logout");
    const out = await as(cookie).post("/auth/logout");
    expect(out.status).toBe(204);
    expect(sessionCookie(out)).toMatch(/dh_session=;/);
    expect((await as(cookie).get("/auth/me")).status).toBe(401);
  });

  it("logout sem sessão também é 204", async () => {
    expect((await request(app).post("/auth/logout")).status).toBe(204);
  });
});

describe("PATCH /auth/me", () => {
  const avatar = { skin: "dark", face: "calm", eyes: "blue", hair: "long", hairColor: "black", hat: "none", beard: "none", outfit: "shirt_green" };

  it("muda o nome", async () => {
    const { cookie } = await createUser("patch-name");
    const res = await as(cookie).patch("/auth/me", { displayName: "  Novo Nome " });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe("Novo Nome");
  });

  it("muda o avatar e persiste", async () => {
    const { cookie } = await createUser("patch-avatar");
    const res = await as(cookie).patch("/auth/me", { avatar });
    expect(res.status).toBe(200);
    expect(res.body.user.avatar).toEqual(avatar);
    expect((await as(cookie).get("/auth/me")).body.user.avatar).toEqual(avatar);
  });

  it("peça de avatar inexistente: 400 'Perfil inválido' com os detalhes", async () => {
    const { cookie } = await createUser("patch-bad");
    const res = await as(cookie).patch("/auth/me", { avatar: { ...avatar, skin: "verde-neon" } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Perfil inválido", code: "VALIDATION_ERROR" });
    expect(res.body.details[0].path).toBe("avatar.skin");
  });

  it("sem login: 401", async () => {
    expect((await request(app).patch("/auth/me").send({ displayName: "Zé" })).status).toBe(401);
  });
});

describe("confirmação de e-mail", () => {
  const PASS = "senha-1234";
  const signUp = async (tag: string) => {
    const email = uniqueEmail(tag);
    await register({ email, password: PASS, displayName: "Novo" }); // pelo service: o endpoint tem rate limit de cadastro
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { email, user };
  };
  // Código conhecido, gravado direto no banco (o e-mail real só vai para o log)
  const seedCode = (userId: string, code = "123456") => emailVerifications.replaceCode(userId, hmac(`${userId}:${code}`), new Date(Date.now() + 15 * 60_000));

  it("login antes de confirmar: 403 EMAIL_NOT_VERIFIED, sem cookie", async () => {
    const { email } = await signUp("ver-login");
    const res = await request(app).post("/auth/login").send({ email, password: PASS });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(sessionCookie(res)).toBeUndefined();
  });

  it("senha errada numa conta não confirmada: 401, igual a qualquer conta (não revela a conta)", async () => {
    const { email } = await signUp("ver-wrongpass");
    const res = await request(app).post("/auth/login").send({ email, password: "errada-123" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("código certo: 200, confirma o e-mail, abre a sessão (cookie httpOnly) e o código não vale duas vezes", async () => {
    const { email, user } = await signUp("ver-ok");
    await seedCode(user.id);

    const res = await request(app).post("/auth/verify-email").send({ email, code: "123456" });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(sessionCookie(res)).toMatch(/HttpOnly/i);
    expect(sessionCookie(res)).toMatch(/SameSite=Lax/i);

    const me = await request(app).get("/auth/me").set("Cookie", sessionCookie(res)!.split(";")[0]);
    expect(me.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();

    // já confirmada: o mesmo código não abre outra sessão
    expect((await request(app).post("/auth/verify-email").send({ email, code: "123456" })).status).toBe(400);
    // e o login normal passa a funcionar
    expect((await request(app).post("/auth/login").send({ email, password: PASS })).status).toBe(200);
  });

  it("código errado: 400 INVALID_VERIFICATION_CODE, tentativa contada, nada confirmado", async () => {
    const { email, user } = await signUp("ver-wrong");
    await seedCode(user.id);
    const res = await request(app).post("/auth/verify-email").send({ email, code: "000000" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "INVALID_VERIFICATION_CODE", error: "Código inválido ou expirado" });
    expect(sessionCookie(res)).toBeUndefined();
    expect((await prisma.emailVerification.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "desc" } })).attempts).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
  });

  it("depois de 5 erros, nem o código certo funciona mais", async () => {
    const { email, user } = await signUp("ver-brute");
    await seedCode(user.id);
    for (let i = 0; i < 5; i++) await request(app).post("/auth/verify-email").send({ email, code: "000000" });
    const res = await request(app).post("/auth/verify-email").send({ email, code: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_VERIFICATION_CODE");
  });

  it("código vencido: 400", async () => {
    const { email, user } = await signUp("ver-expired");
    await seedCode(user.id);
    await prisma.emailVerification.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post("/auth/verify-email").send({ email, code: "123456" })).status).toBe(400);
  });

  it("e-mail inexistente: o mesmo 400 de código errado", async () => {
    const res = await request(app).post("/auth/verify-email").send({ email: uniqueEmail("ghost"), code: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_VERIFICATION_CODE");
  });

  it("formato do código: 400 de validação", async () => {
    const { email } = await signUp("ver-format");
    const res = await request(app).post("/auth/verify-email").send({ email, code: "abc" });
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR", error: "O código tem 6 dígitos" });
  });

  it("reenviar: 204 para conta pendente, inexistente e já confirmada (não revela nada); só o pendente ganha código novo", async () => {
    const pending = await signUp("ver-resend");
    const before = await prisma.emailVerification.count({ where: { userId: pending.user.id } });
    // o cadastro acabou de gerar um código: dentro do cooldown, o reenvio é ignorado
    expect((await request(app).post("/auth/resend-verification").send({ email: pending.email })).status).toBe(204);
    expect(await prisma.emailVerification.count({ where: { userId: pending.user.id } })).toBe(before);

    // fora do cooldown, gera um código novo e invalida o anterior
    await prisma.emailVerification.updateMany({ where: { userId: pending.user.id }, data: { createdAt: new Date(Date.now() - 61_000) } });
    expect((await request(app).post("/auth/resend-verification").send({ email: pending.email })).status).toBe(204);
    expect(await prisma.emailVerification.count({ where: { userId: pending.user.id } })).toBe(before + 1);
    expect(await prisma.emailVerification.count({ where: { userId: pending.user.id, usedAt: null } })).toBe(1);

    const verified = await createUser("ver-already");
    const verifiedBefore = await prisma.emailVerification.count({ where: { userId: verified.user.id } });
    expect((await request(app).post("/auth/resend-verification").send({ email: verified.email })).status).toBe(204);
    expect(await prisma.emailVerification.count({ where: { userId: verified.user.id } })).toBe(verifiedBefore);
    expect((await request(app).post("/auth/resend-verification").send({ email: uniqueEmail("ghost") })).status).toBe(204);
  });
});

describe("recuperação de senha", () => {
  it("forgot-password: 204 para e-mail existente e inexistente (não revela quem tem conta)", async () => {
    const { email } = await createUser("forgot");
    const known = await request(app).post("/auth/forgot-password").send({ email });
    const unknown = await request(app).post("/auth/forgot-password").send({ email: uniqueEmail("nobody") });
    expect(known.status).toBe(204);
    expect(unknown.status).toBe(204);
    expect(known.text).toBe(unknown.text);
  });

  it("forgot-password com e-mail malformado: 400", async () => {
    expect((await request(app).post("/auth/forgot-password").send({ email: "x" })).status).toBe(400);
  });

  it("dois pedidos seguidos geram só um código (cooldown de 1 minuto)", async () => {
    const { email, user } = await createUser("cooldown");
    await request(app).post("/auth/forgot-password").send({ email });
    await request(app).post("/auth/forgot-password").send({ email });
    expect(await prisma.passwordReset.count({ where: { userId: user.id } })).toBe(1);
  });

  // Código conhecido, gravado direto no banco (o e-mail real só vai para o log)
  const seedCode = (userId: string, code = "123456") => passwordResets.replaceCode(userId, hmac(`${userId}:${code}`), new Date(Date.now() + 15 * 60_000));

  it("código errado: 400 INVALID_RESET_CODE e a tentativa é contada", async () => {
    const { email, user } = await createUser("rst-wrong");
    await seedCode(user.id);
    const res = await request(app).post("/auth/reset-password").send({ email, code: "000000", newPassword: "nova-senha-1" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "INVALID_RESET_CODE", error: "Código inválido ou expirado" });
    expect((await prisma.passwordReset.findFirstOrThrow({ where: { userId: user.id } })).attempts).toBe(1);
  });

  it("depois de 5 erros, nem o código certo funciona mais", async () => {
    const { email, user } = await createUser("rst-brute");
    await seedCode(user.id);
    for (let i = 0; i < 5; i++) {
      await request(app).post("/auth/reset-password").send({ email, code: "000000", newPassword: "nova-senha-1" });
    }
    const res = await request(app).post("/auth/reset-password").send({ email, code: "123456", newPassword: "nova-senha-1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_RESET_CODE");
  });

  it("código vencido: 400", async () => {
    const { email, user } = await createUser("rst-expired");
    await seedCode(user.id);
    await prisma.passwordReset.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post("/auth/reset-password").send({ email, code: "123456", newPassword: "nova-senha-1" })).status).toBe(400);
  });

  it("e-mail inexistente: o mesmo 400 de código errado", async () => {
    const res = await request(app).post("/auth/reset-password").send({ email: uniqueEmail("ghost"), code: "123456", newPassword: "nova-senha-1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_RESET_CODE");
  });

  it("formato do código e senha nova fraca: 400 de validação", async () => {
    const { email } = await createUser("rst-format");
    const badCode = await request(app).post("/auth/reset-password").send({ email, code: "abc", newPassword: "nova-senha-1" });
    expect(badCode.body).toMatchObject({ code: "VALIDATION_ERROR", error: "O código tem 6 dígitos" });
    const weak = await request(app).post("/auth/reset-password").send({ email, code: "123456", newPassword: "123" });
    expect(weak.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("código certo: 204, troca a senha, derruba TODAS as sessões e o código não vale duas vezes", async () => {
    const { email, user, cookie } = await createUser("rst-ok");
    const other = await request(app).post("/auth/login").send({ email, password: PASSWORD }); // 2ª sessão
    const otherCookie = sessionCookie(other)!.split(";")[0];
    await seedCode(user.id);

    const res = await request(app).post("/auth/reset-password").send({ email, code: "123456", newPassword: "nova-senha-1" });
    expect(res.status).toBe(204);

    expect((await as(cookie).get("/auth/me")).status).toBe(401);
    expect((await as(otherCookie).get("/auth/me")).status).toBe(401);
    expect((await request(app).post("/auth/login").send({ email, password: PASSWORD })).status).toBe(401); // senha antiga
    expect((await request(app).post("/auth/login").send({ email, password: "nova-senha-1" })).status).toBe(200);

    const reuse = await request(app).post("/auth/reset-password").send({ email, code: "123456", newPassword: "outra-senha-1" });
    expect(reuse.status).toBe(400);
  });
});
