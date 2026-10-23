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

type OAuthState = { createdAt: number; redirectUri: string | null };

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

function isLocalHost(value: string): boolean {
  const v = value.toLowerCase();
  return v.includes("localhost") || v.includes("127.0.0.1");
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isGitHubAppClientId(clientId: string): boolean {
  return /^Iv(1|23)/i.test(clientId);
}

/**
 * GitHub Apps reject a redirect_uri that is not listed on the app
 * ("The redirect_uri is not associated with this application").
 *
 * Hive was sending the Vercel SPA URL. That is not the registered callback,
 * so GitHub stopped the login before our server ran. Production therefore
 * omits redirect_uri and lets GitHub use the first Callback URL on the app.
 * Local sends the API callback so GitHub does not bounce to production.
 *
 * GITHUB_CALLBACK_URL overrides this when it is not a Vercel host — the
 * Vercel path is what GitHub is currently rejecting.
 */
export function oauthCallbackUrl(): string | null {
  const explicit = envTrim("GITHUB_CALLBACK_URL").replace(/\/$/, "");
  if (explicit) {
    const host = hostnameOf(explicit);
    if (!host?.endsWith(".vercel.app")) return explicit;
  }

  if (isLocalHost(appOrigin())) {
    const port = envTrim("PORT") || "8787";
    return `http://localhost:${port}/api/auth/github/callback`;
  }

  return null;
}

export function githubAuthorizeUrl(state: string): string {
  const clientId = envTrim("GITHUB_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    state,
  });
  const callback = oauthCallbackUrl();
  if (callback) params.set("redirect_uri", callback);
  // GitHub Apps only accept `offline_access`; OAuth Apps use user scopes.
  if (!isGitHubAppClientId(clientId)) {
    params.set("scope", "read:user user:email");
  }
  return `https://github.com/login/oauth/authorize?${params}`;
}

function createOAuthState(redirectUri: string | null): string {
  return sealJson({
    createdAt: Date.now(),
    redirectUri,
  } satisfies OAuthState);
}

function readOAuthState(state: string): OAuthState | null {
  const saved = openJson<OAuthState>(state);
  if (!saved || typeof saved.createdAt !== "number") return null;
  if (saved.redirectUri != null && typeof saved.redirectUri !== "string") {
    return null;
  }
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

export function authStatus(_req: Request, res: Response): void {
  const callback = oauthCallbackUrl();
  const clientId = envTrim("GITHUB_CLIENT_ID");
  const secret = envTrim("GITHUB_CLIENT_SECRET");
  res.json({
    github: githubConfigured(),
    appOrigin: appOrigin(),
    redirectUri: callback,
    omitsRedirectUri: !callback,
    /** Deploy marker — bump when auth handoff changes */
    authMode: "registered-callback-v7",
    clientIdPrefix: clientId ? clientId.slice(0, 8) : null,
    secretLen: secret ? secret.length : 0,
    hint: callback
      ? "GitHub App Callback URL must be exactly: " + callback
      : "redirect_uri is omitted so GitHub uses the first Callback URL on the GitHub App. Hive then finishes sign-in from that landing URL.",
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

  const callback = oauthCallbackUrl();
  const state = createOAuthState(callback);
  res.setHeader("Cache-Control", "no-store");
  res.redirect(githubAuthorizeUrl(state));
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

async function exchangeCodeOnce(
  code: string,
  callbackUri: string | null
): Promise<{ token: string | null; error?: string; errorCode?: string }> {
  const clientId = envTrim("GITHUB_CLIENT_ID");
  const clientSecret = envTrim("GITHUB_CLIENT_SECRET");
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
  });
  // Must match authorize: omit when authorize omitted.
  if (callbackUri) body.set("redirect_uri", callbackUri);

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Hive-OAuth",
    },
    body,
  });

  const raw = await res.text();
  let data: GitHubTokenResponse;
  try {
    data = JSON.parse(raw) as GitHubTokenResponse;
  } catch {
    return {
      token: null,
      error: `non_json_${res.status}:${raw.slice(0, 80)}`,
      errorCode: "bad_response",
    };
  }

  if (!data.access_token) {
    const detail = data.error_description || data.error || `http_${res.status}`;
    console.error("[auth] GitHub token exchange failed:", detail, {
      redirect_uri: callbackUri,
      client_id_prefix: clientId.slice(0, 8),
      secret_len: clientSecret.length,
      error: data.error,
    });
    return { token: null, error: detail, errorCode: data.error };
  }
  return { token: data.access_token };
}

async function exchangeCode(
  code: string,
  callbackUri: string | null
): Promise<{ token: string | null; error?: string; errorCode?: string }> {
  const first = await exchangeCodeOnce(code, callbackUri);
  if (first.token) return first;
  if (callbackUri && first.errorCode === "redirect_uri_mismatch") {
    const second = await exchangeCodeOnce(code, null);
    if (second.token) return second;
    return second.error ? second : first;
  }
  return first;
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

/** Bounce a sealed session to the app origin via POST (query tokens get stripped). */
function finishOnApiHost(res: Response, sessionToken: string): void {
  const claim = `${appOrigin()}/api/auth/claim`;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="robots" content="noindex"/><title>Signing in…</title></head>
<body>
<p>Finishing sign-in…</p>
<form id="f" method="POST" action=${JSON.stringify(claim)}>
<input type="hidden" name="h" value=${JSON.stringify(sessionToken)} />
</form>
<script>document.getElementById("f").submit()</script>
</body>
</html>`);
}

function requestLooksLikeAppHost(req: Request): boolean {
  const fwd = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const host = (fwd || req.get("host") || "").toLowerCase();
  const appHost = hostnameOf(appOrigin());
  if (appHost && host === appHost) return true;
  return (
    host.endsWith(".vercel.app") ||
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1")
  );
}

/**
 * If GitHub sent the user to the API homepage (registered callback is the
 * origin, not /api/auth/github/callback), forward onto the real handler.
 */
export function maybeForwardOAuthCallback(req: Request, res: Response): boolean {
  if (req.method !== "GET") return false;
  if (req.path === "/api/auth/github/callback") return false;
  const code = req.query.code;
  const state = req.query.state;
  if (typeof code !== "string" || typeof state !== "string") return false;
  if (!code || !state) return false;

  const q = new URLSearchParams();
  q.set("code", code);
  q.set("state", state);
  const err = req.query.error;
  if (typeof err === "string" && err) q.set("error", err);
  const desc = req.query.error_description;
  if (typeof desc === "string" && desc) q.set("error_description", desc);
  res.setHeader("Cache-Control", "no-store");
  res.redirect(`/api/auth/github/callback?${q}`);
  return true;
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
      const codeHint =
        exchanged.errorCode === "incorrect_client_credentials"
          ? "token_exchange_failed"
          : exchanged.errorCode === "redirect_uri_mismatch"
            ? "redirect_uri_mismatch"
            : exchanged.errorCode === "bad_verification_code"
              ? "bad_verification_code"
              : "token_exchange_failed";
      res.redirect(authErrorRedirect(codeHint, exchanged.error));
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

    // Same-origin (Vercel rewrite / Vite proxy): cookie + sessionStorage.
    if (requestLooksLikeAppHost(req)) {
      const sessionToken = createSession(res, sessionFromStored(user), req);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(sessionBridgeHtml(app, sessionToken));
      return;
    }

    const sessionToken = mintSessionToken(sessionFromStored(user));
    finishOnApiHost(res, sessionToken);
  } catch (e) {
    console.error("[auth] OAuth finish error:", e);
    res.redirect(authErrorRedirect("server_error"));
  }
}
