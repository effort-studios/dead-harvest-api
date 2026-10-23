import cors from "cors";
import express from "express";
import { z } from "zod";
import { config } from "./config";
import { authModule } from "./modules/auth/auth.module";
import { gameModule } from "./modules/game/game.module";
import { healthModule } from "./modules/health/health.module";
import { usersModule } from "./modules/users/users.module";
import { errorHandler } from "./shared/http/errorHandler";
import { notFound } from "./shared/http/notFound";
import { requestId } from "./shared/http/requestId";

z.config(z.locales.pt()); // mensagens de validação do zod em português (o front mostra ao jogador)

export const app = express();

app.set("trust proxy", 1); // atrás do proxy da Railway: req.ip passa a ser o do jogador (rate limit por IP)

app.use(requestId);
app.use(cors({ origin: config.webOrigins, credentials: true })); // só o front pode chamar a API pelo navegador (credentials: o cookie de sessão vai junto)
app.use(express.json({ limit: "100kb" }));

app.use(healthModule);
app.use(authModule);
app.use(usersModule);
app.use(gameModule);

// Sempre por último: rota inexistente (404) e a saída única de erros
app.use(notFound);
app.use(errorHandler);
