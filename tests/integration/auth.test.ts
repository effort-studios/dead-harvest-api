import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import * as passwordResets from "../../src/modules/auth/repositories/password-reset.repository";
import { hmac, sha256 } from "../../src/modules/auth/utils/tokens";
import { prisma } from "../../src/shared/database/prisma";
import { as, cleanupTestUsers, createUser, PASSWORD, uniqueEmail } from "../helpers/users";

beforeAll(cleanupTestUsers);
afterAll(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
});

const sessionCookie = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[] | undefined)?.find((c) => c.startsWith("dh_session="));

describe("POST /auth/register", () => {
  it("cria a conta: 201, cookie de sessão httpOnly e usuário sem dados secretos", async () => {
    const email = uniqueEmail("reg");
    const res = await request(app).post("/auth/register").send({ email, password: PASSWORD, displayName: "Ana" });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, displayName: "Ana", avatar: { hat: "straw" } });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/);
    expect(sessionCookie(res)).toMatch(/HttpOnly/i);
    expect(sessionCookie(res)).toMatch(/SameSite=Lax/i);

    // o cookie recebido já autentica
    const me = await request(app).get("/auth/me").set("Cookie", sessionCookie(res)!.split(";")[0]);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it("a conta nasce com o save inicial (1 terreno e sementes) e o token só é guardado em hash", async () => {
    const email = uniqueEmail("save");
    const res = await request(app).post("/auth/register").send({ email, password: PASSWORD, displayName: "Bia" });
    const token = sessionCookie(res)!.split(";")[0].replace("dh_session=", "");

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { save: { include: { plots: true, inventory: true } }, sessions: true } });
    expect(user.save?.plots).toHaveLength(1);
    expect(user.save?.inventory.length).toBeGreaterThan(0);
    expect(user.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(user.sessions[0].tokenHash).toBe(sha256(token));
    expect(user.sessions[0].tokenHash).not.toBe(token);
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
