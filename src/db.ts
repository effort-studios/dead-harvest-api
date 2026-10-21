import { PrismaClient } from "@prisma/client";

// Uma única instância do client para o app todo (ele gerencia o pool de conexões)
export const prisma = new PrismaClient();
