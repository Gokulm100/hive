import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_DEV_SECRET = "hive-dev-secret-change-in-production";

export type AuthTokenPayload = {
  sub: string;
  email: string;
  exp: number;
};

function authSecret(): string {
  const fromEnv =
    process.env.HIVE_AUTH_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    "";
  return fromEnv || DEFAULT_DEV_SECRET;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function b64urlJson(value: unknown): string {
  return b64url(JSON.stringify(value));
}

function signSegment(header: string, payload: string): string {
  return createHmac("sha256", authSecret())
    .update(`${header}.${payload}`)
    .digest("base64url");
}

export function signAuthToken(user: { id: string; email: string }): string {
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = b64urlJson({
    sub: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  });
  const signature = signSegment(header, payload);
  return `${header}.${payload}.${signature}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return null;

  const expected = signSegment(header, payload);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as AuthTokenPayload;
    if (!parsed.sub || !parsed.email || typeof parsed.exp !== "number") {
      return null;
    }
    if (parsed.exp * 1000 <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isUsingDevAuthSecret(): boolean {
  return !(
    process.env.HIVE_AUTH_SECRET?.trim() || process.env.JWT_SECRET?.trim()
  );
}
