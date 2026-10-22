import type { NextFunction, Request, Response } from "express";
import { sendError } from "../errors";
import { verifyAuthToken } from "./token";

export type AuthedRequest = Request & {
  user?: { id: string; email: string };
};

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export function readAccessToken(req: Request): string | null {
  const fromHeader = readBearerToken(req);
  if (fromHeader) return fromHeader;
  const q = req.query.access_token;
  if (typeof q === "string" && q.trim()) return q.trim();
  return null;
}

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): void {
  const token = readAccessToken(req);
  if (!token) {
    sendError(res, 401, "UNAUTHORIZED", "Login required");
    return;
  }
  const payload = verifyAuthToken(token);
  if (!payload) {
    sendError(res, 401, "UNAUTHORIZED", "Session expired — please log in again");
    return;
  }
  req.user = { id: payload.sub, email: payload.email };
  next();
}
