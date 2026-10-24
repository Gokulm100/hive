import { useCallback, useEffect, useState } from "react";
import {
  captureAuthTokenFromUrl,
  clearSessionToken,
  fetchAuthMe,
  fetchAuthStatus,
  loginAsGuest,
  logout as apiLogout,
  type AuthUser,
} from "../api/client";

export type AuthPhase = "loading" | "guest" | "signed-in";

export type AuthState = {
  phase: AuthPhase;
  user: AuthUser | null;
  githubEnabled: boolean;
  sessionExpired: boolean;
  authError: string | null;
  refresh: () => Promise<void>;
  continueAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
};

function authErrorMessage(code: string | null, detail?: string | null): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    github_not_configured:
      "GitHub sign-in is not set up on this server. Ask the host to add GitHub keys.",
    access_denied: "GitHub sign-in was cancelled.",
    redirect_uri_mismatch:
      "GitHub callback URL mismatch. On the GitHub App, set Callback URL to a Hive URL (API /api/auth/github/callback or the site homepage) and try again.",
    invalid_oauth_state: "Sign-in link expired or was tampered with. Try again.",
    bad_verification_code:
      "GitHub login code expired or was reused. Click Continue with GitHub again (don’t refresh mid-login).",
    token_exchange_failed:
      "GitHub rejected the login token exchange. On Render, check GITHUB_CLIENT_SECRET matches the OAuth App for client Iv23ct… (regenerate secret if unsure).",
    profile_failed: "Could not read your GitHub profile. Try again.",
    session_claim_failed: "Sign-in finished but the session did not stick. Try again.",
    server_error: "Something went wrong during sign-in. Try again.",
  };
  const base = map[code] ?? "Sign-in failed. Try again.";
  if (detail && detail.trim()) return `${base} (${detail.trim()})`;
  return base;
}

export function useAuth(): AuthState {
  const [phase, setPhase] = useState<AuthPhase>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status = await fetchAuthStatus();
      setGithubEnabled(Boolean(status.github));
    } catch {
      setGithubEnabled(false);
    }
    try {
      const me = await fetchAuthMe();
      setUser(me.user);
      setPhase("signed-in");
      setSessionExpired(false);
    } catch {
      clearSessionToken();
      setUser(null);
      setPhase("guest");
    }
  }, []);

  // Never leave the gate on "Loading…" if a request hangs (Render cold start).
  useEffect(() => {
    if (phase !== "loading") return;
    const t = window.setTimeout(() => {
      setPhase((p) => (p === "loading" ? "guest" : p));
    }, 20_000);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthCode = params.get("code");
    const oauthState = params.get("state");
    // GitHub App first Callback URL may be the SPA homepage. Forward to the API.
    if (
      oauthCode &&
      oauthState &&
      !window.location.pathname.includes("/api/auth/github/callback")
    ) {
      const next = new URLSearchParams();
      next.set("code", oauthCode);
      next.set("state", oauthState);
      const oauthErr = params.get("error");
      if (oauthErr) next.set("error", oauthErr);
      const oauthDesc = params.get("error_description");
      if (oauthDesc) next.set("error_description", oauthDesc);
      window.location.replace(`/api/auth/github/callback?${next.toString()}`);
      return;
    }

    captureAuthTokenFromUrl();
    const errCode = params.get("auth_error");
    const errDetail = params.get("auth_detail");
    if (errCode) {
      setAuthError(authErrorMessage(errCode, errDetail));
      params.delete("auth_error");
      params.delete("auth_detail");
      const next = params.toString();
      const url = next
        ? `${window.location.pathname}?${next}`
        : window.location.pathname;
      window.history.replaceState({}, "", url);
    }
    void refresh();
  }, [refresh]);

  const continueAsGuest = useCallback(async () => {
    setAuthError(null);
    try {
      const { user: guest } = await loginAsGuest();
      setUser(guest);
      setPhase("signed-in");
      setSessionExpired(false);
    } catch {
      setAuthError("Guest sign-in failed. Try again.");
      setUser(null);
      setPhase("guest");
    }
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    clearSessionToken();
    setUser(null);
    setPhase("guest");
    setSessionExpired(false);
  }, []);

  return {
    phase,
    user,
    githubEnabled,
    sessionExpired,
    authError,
    refresh,
    continueAsGuest,
    signOut,
  };
}
