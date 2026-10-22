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

/** Lax for same-site (Vite proxy); None+Secure so cookie may work when browsers allow it. */
function sessionCookieFlags(req: Request): string {
  const secure = isSecureRequest(req);
  const sameSite = secure ? "None" : "Lax";
  return `Path=/; HttpOnly; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
}

export function mintSessionToken(user: SessionUser): string {
  return sealJson({
    user,
    exp: Date.now() + SESSION_MS,
  } satisfies SessionPayload);
}

export function userFromSessionToken(token: string): SessionUser | null {
  const payload = openJson<SessionPayload>(token);
  if (!payload?.user?.id || typeof payload.exp !== "number") return null;
  if (Date.now() > payload.exp) return null;
  return payload.user;
}

/** Bearer (SPA) → query (EventSource) → cookie. Cross-site cookies are unreliable. */
export function readSessionToken(req: Request): string | undefined {
  const header = req.get("authorization") || "";
  const bearer = /^Bearer\s+(\S+)/i.exec(header);
  if (bearer?.[1]) return bearer[1];

  const q = req.query?.access_token;
  if (typeof q === "string" && q.trim()) return q.trim();
  if (Array.isArray(q) && typeof q[0] === "string" && q[0].trim()) {
    return q[0].trim();
  }

  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

export function createSession(res: Response, user: SessionUser, req: Request): string {
  const token = mintSessionToken(user);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${sessionCookieFlags(req)}; Max-Age=${Math.floor(SESSION_MS / 1000)}`
  );
  return token;
}

export function clearSession(_req: Request, res: Response): void {
  // Need a request for flags; treat as secure if we can't tell (prod logout).
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`
  );
}

export function getSessionUser(req: Request): SessionUser | null {
  const token = readSessionToken(req);
  if (!token) return null;
  return userFromSessionToken(token);
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
