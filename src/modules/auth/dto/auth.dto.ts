import { z } from "zod";
import { displayName } from "../../users/dto/users.dto";

const email = z.string().trim().toLowerCase().email("E-mail inválido").max(254);
// scrypt trata qualquer tamanho, mas um limite alto evita senhas gigantes para gastar CPU
const password = z.string().min(8, "A senha precisa ter pelo menos 8 caracteres").max(128);

export const registerBody = z.object({ email, password, displayName });
export const loginBody = z.object({ email, password: z.string().min(1, "Informe a senha").max(128) });
export const forgotPasswordBody = z.object({ email });
export const resetPasswordBody = z.object({
  email,
  code: z.string().regex(/^\d{6}$/, "O código tem 6 dígitos"),
  newPassword: password,
});

export type RegisterInput = z.infer<typeof registerBody>;
export type LoginInput = z.infer<typeof loginBody>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordBody>;
export type ResetPasswordInput = z.infer<typeof resetPasswordBody>;
