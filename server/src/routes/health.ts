import { Router } from "express";
import { isCursorConfigured } from "../pool";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "hive-api",
    cursor: isCursorConfigured(),
    model: process.env.CURSOR_MODEL || "composer-2.5",
    cwd: process.env.HIVE_CWD || process.env.NEXUS_CWD || process.cwd(),
  });
});
