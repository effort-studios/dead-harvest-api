import request from "supertest";
import { app } from "../../src/app";
import { register } from "../../src/modules/auth/services/auth.service";
import { prisma } from "../../src/shared/database/prisma";

// Todo usuário de teste tem e-mail neste domínio; é por ele que a limpeza os acha
const TEST_DOMAIN = "example.test";
export const PASSWORD = "senha-1234";

let counter = 0;
export const uniqueEmail = (tag = "u") => `${tag}-${Date.now()}-${counter++}@${TEST_DOMAIN}`;

// Apaga os usuários de teste; o ON DELETE CASCADE leva sessões, save, terrenos, inventário...
export const cleanupTestUsers = () => prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_DOMAIN}` } } });

// Cria um usuário pelo service (sem passar pelo rate limit do cadastro) e já devolve o cookie de sessão
export async function createUser(tag = "u") {
  const email = uniqueEmail(tag);
  const { user, session } = await register({ email, password: PASSWORD, displayName: "Tester" });
  return { user, email, password: PASSWORD, cookie: `dh_session=${session.token}` };
}

// Cliente HTTP já autenticado com o cookie dado
export const as = (cookie: string) => ({
  get: (path: string) => request(app).get(path).set("Cookie", cookie),
  post: (path: string, body: object = {}) => request(app).post(path).set("Cookie", cookie).send(body),
  patch: (path: string, body: object = {}) => request(app).patch(path).set("Cookie", cookie).send(body),
});
