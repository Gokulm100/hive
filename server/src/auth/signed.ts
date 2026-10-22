import { createHmac, timingSafeEqual } from "node:crypto";

function envTrim(name: string): string {
  return (process.env[name] || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

/** Prefer dedicated secret; fall back to GitHub secret so Render works without a new env. */
export function authSigningSecret(): string {
  return (
    envTrim("HIVE_SESSION_SECRET") ||
    envTrim("SESSION_SECRET") ||
    envTrim("GITHUB_CLIENT_SECRET") ||
    "hive-dev-session-secret"
  );
}

function sign(payloadB64: string): string {
  return createHmac("sha256", authSigningSecret())
    .update(payloadB64)
    .digest("base64url");
}

/** Compact HMAC token: base64url(json).base64url(hmac). Survives Render restarts. */
export function sealJson(value: unknown): string {
  const payloadB64 = Buffer.from(JSON.stringify(value), "utf8").toString(
    "base64url"
  );
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function openJson<T>(token: string): T | null {
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const payloadB64 = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(payloadB64);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    return JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    ) as T;
  } catch {
    return null;
  }
}
