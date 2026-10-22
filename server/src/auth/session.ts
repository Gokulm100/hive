import type { Request, Response, NextFunction } from "express";
import type { StoredUser } from "../users/store";
import { publicUser } from "../users/store";
import { openJson, sealJson } from "./signed";

export type SessionUser = ReturnType<typeof publicUser>;

type SessionPayload = {
  user: SessionUser;
  exp: number;
};

const SESSION_COOKIE = "hive_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function isSecureRequest(req: Request): boolean {
  if (req.secure) return true;
  const fwd = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  if (fwd === "https") return true;
  const host = req.get("host") || "";
  return host.endsWith(".onrender.com");
}

/** Lax for same-site (Vite proxy); None+Secure so Vercel → Render can send the cookie. */
function sessionCookieFlags(req: Request): string {
  const secure = isSecureRequest(req);
  const sameSite = secure ? "None" : "Lax";
  return `Path=/; HttpOnly; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
}

export function createSession(res: Response, user: SessionUser, req: Request): string {
  const token = sealJson({
    user,
    exp: Date.now() + SESSION_MS,
  } satisfies SessionPayload);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${sessionCookieFlags(req)}; Max-Age=${Math.floor(SESSION_MS / 1000)}`
  );
  return token;
}

export function clearSession(req: Request, res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; ${sessionCookieFlags(req)}; Max-Age=0`
  );
}

function getSessionToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

export function getSessionUser(req: Request): SessionUser | null {
  const token = getSessionToken(req);
  if (!token) return null;
  const payload = openJson<SessionPayload>(token);
  if (!payload?.user?.id || typeof payload.exp !== "number") return null;
  if (Date.now() > payload.exp) return null;
  return payload.user;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({
      error: "Sign in required",
      code: "SESSION_EXPIRED",
    });
    return;
  }
  (req as Request & { user?: SessionUser }).user = user;
  next();
}

export function sessionFromStored(user: StoredUser): SessionUser {
  return publicUser(user);
}
