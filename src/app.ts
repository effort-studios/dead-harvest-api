import cors from "cors";
import express, { ErrorRequestHandler } from "express";
import { config } from "./config";
import { healthRouter } from "./routes/health";
import { playersRouter } from "./routes/players";
import { savesRouter } from "./routes/saves";

export const app = express();

app.use(cors({ origin: config.webUrl })); // só o front pode chamar a API pelo navegador
app.use(express.json({ limit: "100kb" }));

app.use(healthRouter);
app.use(playersRouter);
app.use(savesRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno" });
};
app.use(errorHandler);
