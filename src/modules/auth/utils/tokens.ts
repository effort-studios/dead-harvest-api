import { createHash, createHmac } from "node:crypto";
import { config } from "../../../config";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// HMAC com o segredo do app: o código de redefinição não pode ser calculado só com o que está no banco
export const hmac = (value: string) => createHmac("sha256", config.authSecret).update(value).digest("hex");
