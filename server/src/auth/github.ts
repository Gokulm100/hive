import type { Request, Response } from "express";
import {
  findUserByGithubId,
  upsertGitHubUser,
  type StoredUser,
} from "../users/store";
import { createSession, sessionFromStored } from "./session";

const oauthStates = new Map<string, { createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000;

function githubConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_CLIENT_ID?.trim() &&
      process.env.GITHUB_CLIENT_SECRET?.trim()
  );
}

function appOrigin(): string {
  const fromEnv =
    process.env.HIVE_APP_URL?.trim() ||
    process.env.VITE_APP_URL?.trim() ||
    "http://localhost:5173";
  return fromEnv.replace(/\/$/, "");
}

function apiOrigin(req: Request): string {
  const fromEnv = process.env.HIVE_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const host = req.get("host") || `localhost:${process.env.PORT || 8787}`;
  const proto = req.secure || req.get("x-forwarded-proto") === "https" ? "https" : "http";
  return `${proto}://${host}`;
}

function redirectUri(req: Request): string {
  const fromEnv = process.env.GITHUB_CALLBACK_URL?.trim();
  if (fromEnv) return fromEnv;
  return `${apiOrigin(req)}/api/auth/github/callback`;
}

function pruneStates(): void {
  const now = Date.now();
  for (const [k, v] of oauthStates) {
    if (now - v.createdAt > STATE_TTL_MS) oauthStates.delete(k);
  }
}

export function authStatus(_req: Request, res: Response): void {
  res.json({
    github: githubConfigured(),
    appOrigin: appOrigin(),
  });
}

export function startGitHubOAuth(req: Request, res: Response): void {
  if (!githubConfigured()) {
    res.status(503).json({
      error: "GitHub sign-in is not configured on this server.",
      code: "GITHUB_NOT_CONFIGURED",
    });
    return;
  }

  pruneStates();
  const state = crypto.randomUUID();
  oauthStates.set(state, { createdAt: Date.now() });

  const clientId = process.env.GITHUB_CLIENT_ID!.trim();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    scope: "read:user user:email",
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
}

type GitHubTokenResponse = {
  access_token?: string;
  error?: string;
};

type GitHubProfile = {
  id: number;
  login: string;
  avatar_url: string;
  email: string | null;
};

async function exchangeCode(
  req: Request,
  code: string
): Promise<string | null> {
  const clientId = process.env.GITHUB_CLIENT_ID!.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET!.trim();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri(req),
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
  return data.access_token ?? null;
}

async function fetchGitHubProfile(token: string): Promise<GitHubProfile | null> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Hive-OAuth",
    },
  });
  if (!res.ok) return null;
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
  if (!state || !oauthStates.has(state) || !code) {
    res.redirect(`${appOrigin()}/?auth_error=invalid_oauth_state`);
    return;
  }
  oauthStates.delete(state);

  try {
    const token = await exchangeCode(req, code);
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

    createSession(res, sessionFromStored(user), req);
    res.redirect(`${appOrigin()}/`);
  } catch {
    res.redirect(`${appOrigin()}/?auth_error=server_error`);
  }
}
