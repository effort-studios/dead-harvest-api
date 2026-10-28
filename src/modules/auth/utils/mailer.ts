import { Resend } from "resend";
import { config } from "../../../config";

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

const SUBJECT = "Código para redefinir sua senha";

function html(code: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 12px">Dead Harvest</h2>
  <p>Use o código abaixo para redefinir sua senha. Ele vale ${config.resetCodeMinutes} minutos.</p>
  <p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:20px 0">${code}</p>
  <p style="color:#666;font-size:13px">Se você não pediu isso, ignore este e-mail: sua senha continua a mesma.</p>
</div>`;
}

const text = (code: string) => `Seu código para redefinir a senha é ${code} (vale ${config.resetCodeMinutes} minutos). Se você não pediu isso, ignore este e-mail.`;

// Sem RESEND_API_KEY, em desenvolvimento o e-mail é escrito no log da API; em produção o código
// NÃO é escrito no log, para não vazar.
export async function sendPasswordResetCode(to: string, code: string): Promise<void> {
  if (!resend) {
    if (config.isProduction) console.error("[mailer] RESEND_API_KEY não configurada: código de redefinição não enviado");
    else console.log(`\n[mailer] E-mail para ${to}\n  Assunto: ${SUBJECT}\n  Seu código é ${code} (vale ${config.resetCodeMinutes} minutos)\n`);
    return;
  }
  // O SDK devolve o erro em vez de lançar. O endpoint responde 204 de qualquer jeito (não revela se o e-mail existe),
  // então uma falha de envio só é registrada.
  const { error } = await resend.emails.send({ from: config.mailFrom, to, subject: SUBJECT, html: html(code), text: text(code) });
  if (error) console.error(`[mailer] falha ao enviar e-mail de redefinição: ${error.name}: ${error.message}`);
}
