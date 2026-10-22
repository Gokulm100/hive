import type { Request, Response, NextFunction } from "express";
import type { StoredUser } from "../users/store";
import { publicUser } from "../users/store";

export type SessionUser = ReturnType<typeof publicUser>;

type Session = {
  id: string;
  user: SessionUser;
  expiresAt: number;
};

const SESSION_COOKIE = "hive_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

const sessions = new Map<string, Session>();

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
  const fwd = req.headers["x-forwarded-proto"];
  return fwd === "https";
}

/** Lax for same-site (Vite proxy); None+Secure so Vercel → Render can send the cookie. */
function sessionCookieFlags(req: Request): string {
  const secure = isSecureRequest(req);
  // Cross-origin SPA (e.g. *.vercel.app → *.onrender.com) needs SameSite=None
  const sameSite = secure ? "None" : "Lax";
  return `Path=/; HttpOnly; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
}

export function createSession(res: Response, user: SessionUser, req: Request): string {
  const id = crypto.randomUUID();
  sessions.set(id, {
    id,
    user,
    expiresAt: Date.now() + SESSION_MS,
  });
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(id)}; ${sessionCookieFlags(req)}; Max-Age=${Math.floor(SESSION_MS / 1000)}`
  );
  return id;
}

export function clearSession(req: Request, res: Response): void {
  const cookies = parseCookies(req.headers.cookie);
  const id = cookies[SESSION_COOKIE];
  if (id) sessions.delete(id);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; ${sessionCookieFlags(req)}; Max-Age=0`
  );
}

function getSessionId(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

export function getSessionUser(req: Request): SessionUser | null {
  const id = getSessionId(req);
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(id);
    return null;
  }
  return session.user;
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
