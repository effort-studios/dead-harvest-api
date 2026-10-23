import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { readCookie } from "../../../src/modules/auth/utils/cookies";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../../../src/modules/auth/utils/password";
import { hmac, sha256 } from "../../../src/modules/auth/utils/tokens";

const reqWith = (cookie?: string) => ({ headers: { cookie } }) as Request;

describe("readCookie", () => {
  it("lê um cookie entre vários", () => {
    expect(readCookie(reqWith("a=1; dh_session=abc; b=2"), "dh_session")).toBe("abc");
  });

  it("devolve undefined quando não há o cookie ou nenhum cookie", () => {
    expect(readCookie(reqWith("a=1"), "dh_session")).toBeUndefined();
    expect(readCookie(reqWith(undefined), "dh_session")).toBeUndefined();
  });

  it("decodifica o valor e mantém '=' dentro dele", () => {
    expect(readCookie(reqWith("dh_session=a%20b=c"), "dh_session")).toBe("a b=c");
  });

  it("escape inválido (%zz) é tratado como ausente, sem estourar", () => {
    expect(readCookie(reqWith("dh_session=%zz"), "dh_session")).toBeUndefined();
  });
});

describe("password", () => {
  it("verifica a senha certa e recusa a errada", async () => {
    const hash = await hashPassword("senha-1234");
    expect(await verifyPassword("senha-1234", hash)).toBe(true);
    expect(await verifyPassword("senha-12345", hash)).toBe(false);
  });

  it("usa um salt por senha (mesma senha, hashes diferentes) e não guarda a senha em claro", async () => {
    const [a, b] = await Promise.all([hashPassword("senha-1234"), hashPassword("senha-1234")]);
    expect(a).not.toBe(b);
    expect(a).not.toContain("senha-1234");
    expect(a.startsWith("scrypt$")).toBe(true);
  });

  it("formato guardado inválido nunca autentica", async () => {
    expect(await verifyPassword("x", "lixo")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$a$b")).toBe(false);
    expect(await verifyPassword("x", "scrypt$$")).toBe(false);
  });

  it("DUMMY_HASH gasta o tempo de verificação mas nunca aceita senha", async () => {
    expect(await verifyPassword("qualquer-coisa", DUMMY_HASH)).toBe(false);
  });
});

describe("tokens", () => {
  it("sha256 é determinístico e hex de 64 caracteres", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sha256("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hmac depende do segredo do app (difere do sha256 puro)", () => {
    expect(hmac("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hmac("abc")).not.toBe(sha256("abc"));
  });
});
