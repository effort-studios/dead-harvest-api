import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resend } from "resend";
import { config } from "../../../config";

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

const BANNER_ID = "dead-harvest-banner";

// Banner embutido no e-mail (CID), para não depender de nenhum site no ar. Sem o arquivo, o e-mail sai sem a imagem.
const banner = (() => {
  try {
    return readFileSync(resolve(process.cwd(), "assets/email-banner.png")).toString("base64");
  } catch {
    return null;
  }
})();

// Cores do design system do jogo (src/shared/ui/tokens.css do front). E-mail não carrega a fonte Duality,
// então os números usam monoespaçada, e a "moldura" é feita com bordas e sombra dura.
const C = {
  grass: "#4f7f3b",
  panel: "#2b2118",
  slot: "#1d160f",
  gold: "#ffd75e",
  goldFrame: "#c89e61",
  goldDark: "#6c4620",
  text: "#f3e6c8",
  muted: "#b8a888",
};
const MONO = "'Courier New',Courier,monospace";

function html(code: string, intro: string, ignoreNote: string): string {
  const image = banner
    ? `<tr><td style="padding:0;line-height:0"><img src="cid:${BANNER_ID}" width="480" alt="Dead Harvest" style="display:block;width:100%;max-width:480px;height:auto;border:0;image-rendering:pixelated"></td></tr>`
    : "";
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:${C.grass}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.grass};padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:${C.panel};border:4px solid ${C.goldFrame};box-shadow:0 0 0 4px ${C.goldDark},6px 6px 0 4px rgba(0,0,0,.35)">
    ${image}
    <tr><td align="center" style="padding:24px 24px 4px;font-family:${MONO};color:${C.gold};font-size:26px;font-weight:bold;letter-spacing:2px;text-shadow:2px 2px 0 ${C.goldDark}">DEAD HARVEST</td></tr>
    <tr><td align="center" style="padding:8px 28px 0;font-family:${MONO};color:${C.text};font-size:15px;line-height:22px">${intro}<br>Ele vale ${config.resetCodeMinutes} minutos.</td></tr>
    <tr><td align="center" style="padding:20px 28px">
      <table role="presentation" cellspacing="0" cellpadding="0" style="background:${C.slot};border:3px solid ${C.goldFrame};box-shadow:3px 3px 0 ${C.goldDark}">
        <tr><td align="center" style="padding:14px 22px;font-family:${MONO};color:${C.gold};font-size:38px;font-weight:bold;letter-spacing:10px;text-shadow:2px 2px 0 ${C.goldDark}">${code}</td></tr>
      </table>
    </td></tr>
    <tr><td align="center" style="padding:0 28px 26px;font-family:${MONO};color:${C.muted};font-size:12px;line-height:18px">${ignoreNote}</td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

type CodeEmail = { subject: string; intro: string; ignoreNote: string; plain: string };

const PASSWORD_RESET: CodeEmail = {
  subject: "Código para redefinir sua senha",
  intro: "Use o código abaixo para redefinir sua senha.",
  ignoreNote: "Se você não pediu isso, ignore este e-mail:<br>sua senha continua a mesma.",
  plain: "Seu código para redefinir a senha é {code} (vale {min} minutos). Se você não pediu isso, ignore este e-mail.",
};

const EMAIL_VERIFICATION: CodeEmail = {
  subject: "Confirme seu e-mail no Dead Harvest",
  intro: "Use o código abaixo para confirmar seu e-mail e entrar na fazenda.",
  ignoreNote: "Se você não criou uma conta,<br>ignore este e-mail.",
  plain: "Seu código para confirmar o e-mail é {code} (vale {min} minutos). Se você não criou uma conta, ignore este e-mail.",
};

// Sem RESEND_API_KEY, em desenvolvimento o e-mail é escrito no log da API; em produção o código
// NÃO é escrito no log, para não vazar.
async function sendCode(to: string, code: string, mail: CodeEmail): Promise<void> {
  if (!resend) {
    if (config.isProduction) console.error("[mailer] RESEND_API_KEY não configurada: código não enviado");
    else
      console.log(`
[mailer] E-mail para ${to}
  Assunto: ${mail.subject}
  Seu código é ${code} (vale ${config.resetCodeMinutes} minutos)
`);
    return;
  }
  // O SDK devolve o erro em vez de lançar. Os endpoints respondem igual de qualquer jeito (não revelam se o e-mail
  // existe), então uma falha de envio só é registrada.
  const { error } = await resend.emails.send({
    from: config.mailFrom,
    to,
    subject: mail.subject,
    html: html(code, mail.intro, mail.ignoreNote),
    text: mail.plain.replace("{code}", code).replace("{min}", String(config.resetCodeMinutes)),
    attachments: banner ? [{ filename: "dead-harvest.png", content: banner, contentType: "image/png", contentId: BANNER_ID }] : undefined,
  });
  if (error) console.error(`[mailer] falha ao enviar "${mail.subject}": ${error.name}: ${error.message}`);
}

export const sendPasswordResetCode = (to: string, code: string) => sendCode(to, code, PASSWORD_RESET);
export const sendEmailVerificationCode = (to: string, code: string) => sendCode(to, code, EMAIL_VERIFICATION);
