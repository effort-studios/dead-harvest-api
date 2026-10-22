import cors from "cors";
import express, { ErrorRequestHandler } from "express";
import { config } from "./config";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { savesRouter } from "./routes/saves";

export const app = express();

app.use(cors({ origin: config.webOrigins, credentials: true })); // só o front pode chamar a API pelo navegador (credentials: o cookie de sessão vai junto)
app.use(express.json({ limit: "100kb" }));

app.use(healthRouter);
app.use(authRouter);
app.use(savesRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno" });
};
app.use(errorHandler);
