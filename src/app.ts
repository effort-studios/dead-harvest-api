import cors from "cors";
import express from "express";
import { z } from "zod";
import { config } from "./config";
import { authRouter } from "./modules/auth/auth.routes";
import { gameRouter } from "./modules/game/game.routes";
import { healthRouter } from "./modules/health/health.routes";
import { usersRouter } from "./modules/users/users.routes";
import { errorHandler } from "./shared/http/errorHandler";
import { notFound } from "./shared/http/notFound";
import { requestId } from "./shared/http/requestId";

z.config(z.locales.pt()); // mensagens de validação do zod em português (o front mostra ao jogador)

export const app = express();

app.use(requestId);
app.use(cors({ origin: config.webOrigins, credentials: true })); // só o front pode chamar a API pelo navegador (credentials: o cookie de sessão vai junto)
app.use(express.json({ limit: "100kb" }));

app.use(healthRouter);
app.use(authRouter);
app.use(usersRouter);
app.use(gameRouter);

// Sempre por último: rota inexistente (404) e a saída única de erros
app.use(notFound);
app.use(errorHandler);
