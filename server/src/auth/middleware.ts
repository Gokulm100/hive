import type { Request, Response, NextFunction } from "express";
import { sendError } from "../errors";
import { readSessionId } from "./session";

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const userId = readSessionId(req);
  if (!userId) {
    sendError(res, 401, "UNAUTHORIZED", "Log in to use live mode");
    return;
  }
  (req as Request & { userId?: string }).userId = userId;
  next();
}
