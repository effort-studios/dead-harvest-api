import { Prisma } from "@prisma/client";

// Erro conhecido do Prisma com o código dado (ex.: "P2002" = violação de unique)
export const isPrismaError = (err: unknown, code: string): boolean => err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
