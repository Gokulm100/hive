import type { Request, Response } from "express";
import {
  findUserByGithubId,
  upsertGitHubUser,
  type StoredUser,
} from "../users/store";
import {
  createSession,
  mintSessionToken,
  sessionFromStored,
} from "./session";
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

/**
 * Callback must be on the *app* host (Vercel / Vite) so the browser stays
 * same-origin when we set cookie + sessionStorage. GitHub → app/api/... →
 * rewrite → Render. Avoids Render→Vercel cross-origin handoff failures.
 *
 * GITHUB_CALLBACK_URL is honored only when it is not a Render URL while the
 * app lives on Vercel (that combo is the broken handshake).
 */
function redirectUri(_req: Request): string {
  const appCb = `${appOrigin()}/api/auth/github/callback`;
  const fromEnv = envTrim("GITHUB_CALLBACK_URL").replace(/\/$/, "");
  if (!fromEnv) return appCb;
  try {
    const envHost = new URL(fromEnv).hostname.toLowerCase();
    const appHost = new URL(appOrigin()).hostname.toLowerCase();
    if (envHost.endsWith(".onrender.com") && appHost.endsWith(".vercel.app")) {
      console.warn(
        "[auth] Ignoring GITHUB_CALLBACK_URL on Render; using app callback:",
        appCb
      );
      return appCb;
    }
  } catch {
    /* keep fromEnv */
  }
  return fromEnv;
}

function createOAuthState(redirectUriValue: string): string {
  return sealJson({
    createdAt: Date.now(),
    redirectUri: redirectUriValue,
  } satisfies OAuthState);
}

function readOAuthState(state: string): OAuthState | null {
  const saved = openJson<OAuthState>(state);
  if (!saved?.redirectUri || typeof saved.createdAt !== "number") return null;
  if (Date.now() - saved.createdAt > STATE_TTL_MS) return null;
  return saved;
}

function authErrorRedirect(code: string, detail?: string): string {
  const u = new URL(`${appOrigin()}/`);
  u.searchParams.set("auth_error", code);
  if (detail) u.searchParams.set("auth_detail", detail.slice(0, 180));
  return u.toString();
}

/** HTML bridge: cookie already Set-Cookie'd; write sessionStorage then go home. */
function sessionBridgeHtml(app: string, sessionToken: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="robots" content="noindex"/><title>Signing in…</title></head>
<body>
<p>Signing you in…</p>
<script>
(function () {
  var t = ${JSON.stringify(sessionToken)};
  try { sessionStorage.setItem("hive_session_token", t); } catch (e) {}
  try { localStorage.setItem("hive_session_token", t); } catch (e) {}
  location.replace(${JSON.stringify(app + "/")});
})();
</script>
</body>
</html>`;
}

export function authStatus(req: Request, res: Response): void {
  const callback = redirectUri(req);
  res.json({
    github: githubConfigured(),
    appOrigin: appOrigin(),
    /** Must match “Authorization callback URL” on the GitHub OAuth App exactly */
    redirectUri: callback,
    /** Deploy marker — bump when auth handoff changes */
    authMode: "same-origin-callback-v6",
    hint:
      "GitHub OAuth App callback URL must be exactly: " +
      callback +
      " (use the app/Vercel host, not onrender.com)",
  });
}

export function startGitHubOAuth(req: Request, res: Response): void {
  if (!githubConfigured()) {
    const wantsHtml = String(req.get("accept") || "").includes("text/html");
    if (wantsHtml) {
      res.redirect(authErrorRedirect("github_not_configured"));
      return;
    }
    res.status(503).json({
      error: "GitHub sign-in is not configured on this server.",
      code: "GITHUB_NOT_CONFIGURED",
    });
    return;
  }

  const callback = redirectUri(req);
  const state = createOAuthState(callback);

  const clientId = envTrim("GITHUB_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    scope: "read:user user:email",
    state,
  });

  res.setHeader("Cache-Control", "no-store");
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

/**
 * If callback hit the API host directly (old Render URL), bounce the sealed
 * session to the app origin claim endpoint via top-level GET (not cross-site POST).
 */
function finishOnApiHost(res: Response, sessionToken: string): void {
  const claim = new URL(`${appOrigin()}/api/auth/claim`);
  claim.searchParams.set("h", sessionToken);
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, claim.toString());
}

function requestLooksLikeAppHost(req: Request): boolean {
  const fwd = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const host = (fwd || req.get("host") || "").toLowerCase();
  const appHost = appOrigin().replace(/^https?:\/\//, "").toLowerCase();
  if (appHost && host === appHost) return true;
  return (
    host.endsWith(".vercel.app") ||
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1")
  );
}

export async function finishGitHubOAuth(req: Request, res: Response): Promise<void> {
  if (!githubConfigured()) {
    res.redirect(authErrorRedirect("github_not_configured"));
    return;
  }

  const err = String(req.query.error ?? "");
  if (err) {
    const detail = String(req.query.error_description ?? "");
    res.redirect(authErrorRedirect(err, detail || undefined));
    return;
  }

  const state = String(req.query.state ?? "");
  const code = String(req.query.code ?? "");
  const saved = state ? readOAuthState(state) : null;
  if (!state || !saved || !code) {
    console.error("[auth] invalid_oauth_state", {
      hasState: Boolean(state),
      stateOk: Boolean(saved),
      hasCode: Boolean(code),
    });
    res.redirect(authErrorRedirect("invalid_oauth_state"));
    return;
  }

  try {
    const exchanged = await exchangeCode(code, saved.redirectUri);
    if (!exchanged.token) {
      res.redirect(
        authErrorRedirect("token_exchange_failed", exchanged.error)
      );
      return;
    }

    const profile = await fetchGitHubProfile(exchanged.token);
    if (!profile) {
      res.redirect(authErrorRedirect("profile_failed"));
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

    const app = appOrigin();

    // Same-origin (Vercel rewrite): set cookie on app host + sessionStorage bridge.
    if (requestLooksLikeAppHost(req)) {
      const sessionToken = createSession(res, sessionFromStored(user), req);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(sessionBridgeHtml(app, sessionToken));
      return;
    }

    // Legacy: callback hit Render directly — redirect to app claim with token.
    const sessionToken = mintSessionToken(sessionFromStored(user));
    finishOnApiHost(res, sessionToken);
  } catch (e) {
    console.error("[auth] OAuth finish error:", e);
    res.redirect(authErrorRedirect("server_error"));
  }
}
