import type { Request, Response } from "express";
import {
  findUserByGithubId,
  upsertGitHubUser,
  type StoredUser,
} from "../users/store";
import { createSession, sessionFromStored } from "./session";
import { openJson, sealJson } from "./signed";

type OAuthState = { createdAt: number; redirectUri: string };

const STATE_TTL_MS = 10 * 60 * 1000;

function envTrim(name: string): string {
  return (process.env[name] || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function githubConfigured(): boolean {
  return Boolean(envTrim("GITHUB_CLIENT_ID") && envTrim("GITHUB_CLIENT_SECRET"));
}

function appOrigin(): string {
  const fromEnv =
    envTrim("HIVE_APP_URL") ||
    envTrim("VITE_APP_URL") ||
    "http://localhost:5173";
  return fromEnv.replace(/\/$/, "");
}

function apiOrigin(req: Request): string {
  const fromEnv = envTrim("HIVE_API_URL");
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const host = req.get("host") || `localhost:${process.env.PORT || 8787}`;
  const forwarded = String(req.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim();
  // Render / proxies: prefer forwarded proto; .onrender.com is always https
  const proto =
    forwarded === "https" ||
    req.secure ||
    host.endsWith(".onrender.com")
      ? "https"
      : "http";
  return `${proto}://${host}`;
}

function redirectUri(req: Request): string {
  const fromEnv = envTrim("GITHUB_CALLBACK_URL");
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return `${apiOrigin(req)}/api/auth/github/callback`;
}

function createOAuthState(redirectUri: string): string {
  return sealJson({
    createdAt: Date.now(),
    redirectUri,
  } satisfies OAuthState);
}

function readOAuthState(state: string): OAuthState | null {
  const saved = openJson<OAuthState>(state);
  if (!saved?.redirectUri || typeof saved.createdAt !== "number") return null;
  if (Date.now() - saved.createdAt > STATE_TTL_MS) return null;
  return saved;
}

export function authStatus(req: Request, res: Response): void {
  res.json({
    github: githubConfigured(),
    appOrigin: appOrigin(),
    /** Must match “Authorization callback URL” on the GitHub OAuth App exactly */
    redirectUri: redirectUri(req),
    /** Deploy marker: SPA auth uses ?hive_token= + Bearer, not cross-site cookies alone */
    authMode: "signed-bearer",
  });
}

export function startGitHubOAuth(req: Request, res: Response): void {
  if (!githubConfigured()) {
    const wantsHtml = String(req.get("accept") || "").includes("text/html");
    if (wantsHtml) {
      res.redirect(`${appOrigin()}/?auth_error=github_not_configured`);
      return;
    }
    res.status(503).json({
      error: "GitHub sign-in is not configured on this server.",
      code: "GITHUB_NOT_CONFIGURED",
    });
    return;
  }

  const callback = redirectUri(req);
  // Signed state (no in-memory Map) so Render restarts / cold starts can't break OAuth
  const state = createOAuthState(callback);

  const clientId = envTrim("GITHUB_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    scope: "read:user user:email",
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
}

type GitHubTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GitHubProfile = {
  id: number;
  login: string;
  avatar_url: string;
  email: string | null;
};

async function exchangeCode(
  code: string,
  callbackUri: string
): Promise<{ token: string | null; error?: string }> {
  const clientId = envTrim("GITHUB_CLIENT_ID");
  const clientSecret = envTrim("GITHUB_CLIENT_SECRET");
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: callbackUri,
  });

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await res.json()) as GitHubTokenResponse;
  if (!data.access_token) {
    const detail = data.error_description || data.error || `http_${res.status}`;
    console.error("[auth] GitHub token exchange failed:", detail, {
      redirect_uri: callbackUri,
      client_id_prefix: clientId.slice(0, 8),
    });
    return { token: null, error: detail };
  }
  return { token: data.access_token };
}

async function fetchGitHubProfile(token: string): Promise<GitHubProfile | null> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Hive-OAuth",
    },
  });
  if (!res.ok) {
    console.error("[auth] GitHub profile failed:", res.status);
    return null;
  }
  const profile = (await res.json()) as GitHubProfile;

  if (!profile.email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Hive-OAuth",
      },
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary =
        emails.find((e) => e.primary && e.verified) ||
        emails.find((e) => e.verified) ||
        emails[0];
      if (primary) profile.email = primary.email;
    }
  }

  return profile;
}

export async function finishGitHubOAuth(req: Request, res: Response): Promise<void> {
  if (!githubConfigured()) {
    res.redirect(`${appOrigin()}/?auth_error=github_not_configured`);
    return;
  }

  const err = String(req.query.error ?? "");
  if (err) {
    res.redirect(`${appOrigin()}/?auth_error=${encodeURIComponent(err)}`);
    return;
  }

  const state = String(req.query.state ?? "");
  const code = String(req.query.code ?? "");
  const saved = state ? readOAuthState(state) : null;
  if (!state || !saved || !code) {
    res.redirect(`${appOrigin()}/?auth_error=invalid_oauth_state`);
    return;
  }

  try {
    const { token } = await exchangeCode(code, saved.redirectUri);
    if (!token) {
      res.redirect(`${appOrigin()}/?auth_error=token_exchange_failed`);
      return;
    }

    const profile = await fetchGitHubProfile(token);
    if (!profile) {
      res.redirect(`${appOrigin()}/?auth_error=profile_failed`);
      return;
    }

    let user: StoredUser | undefined = await findUserByGithubId(profile.id);
    if (!user) {
      user = await upsertGitHubUser({
        githubId: profile.id,
        login: profile.login,
        email: profile.email,
        avatarUrl: profile.avatar_url,
      });
    }

    // Pass token in the redirect — browsers block cross-site cookies (Vercel → Render).
    const token = createSession(res, sessionFromStored(user), req);
    const dest = new URL(`${appOrigin()}/`);
    dest.searchParams.set("hive_token", token);
    res.redirect(dest.toString());
  } catch (e) {
    console.error("[auth] OAuth finish error:", e);
    res.redirect(`${appOrigin()}/?auth_error=server_error`);
  }
}
