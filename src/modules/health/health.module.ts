import { Router } from "express";

export const healthModule = Router();

healthModule.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
