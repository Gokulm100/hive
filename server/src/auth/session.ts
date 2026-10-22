import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

const COOKIE_NAME = "hive_session";

type SessionRecord = {
  userId: string;
  createdAt: number;
};

const sessions = new Map<string, SessionRecord>();

let ephemeralSecret: string | undefined;

function secretKey(): string {
  const fromEnv = process.env.HIVE_SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString("hex");
    process.env._HIVE_EPHEMERAL_SECRET = ephemeralSecret;
  }
  return ephemeralSecret;
}

function sign(token: string): string {
  return createHmac("sha256", secretKey()).update(token).digest("hex");
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

export function readSessionId(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const token = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(token);
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  const record = sessions.get(token);
  if (!record) return null;
  return record.userId;
}

export function createSession(userId: string, res: Response): void {
  const token = randomBytes(24).toString("hex");
  sessions.set(token, { userId, createdAt: Date.now() });
  const value = `${token}.${sign(token)}`;
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`
  );
}

export function destroySession(req: Request, res: Response): void {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (raw) {
    const dot = raw.lastIndexOf(".");
    if (dot > 0) {
      sessions.delete(raw.slice(0, dot));
    }
  }
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

/** Test helper — drop all sessions */
export function clearAllSessions(): void {
  sessions.clear();
}

export { COOKIE_NAME };
