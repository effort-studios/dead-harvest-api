import { config } from "../config";

// Envio de e-mail. Ainda não há provedor configurado: em desenvolvimento o e-mail é escrito no log da API.
// Em produção isto precisa ser trocado por um provedor real (SMTP, Resend, SendGrid...); até lá,
// o código de redefinição NÃO é escrito no log, para não vazar.
export async function sendPasswordResetCode(to: string, code: string): Promise<void> {
  if (config.isProduction) {
    console.error("[mailer] provedor de e-mail não configurado: código de redefinição não enviado");
    return;
  }
  console.log(`\n[mailer] E-mail para ${to}\n  Assunto: Código para redefinir sua senha\n  Seu código é ${code} (vale ${config.resetCodeMinutes} minutos)\n`);
}
