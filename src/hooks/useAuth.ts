import { useCallback, useEffect, useState } from "react";
import {
  captureAuthTokenFromUrl,
  clearSessionToken,
  fetchAuthMe,
  fetchAuthStatus,
  loginAsGuest,
  logout as apiLogout,
  onUnauthorized,
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

function authErrorMessage(code: string | null): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    github_not_configured:
      "GitHub sign-in is not set up on this server. Ask the host to add GitHub keys.",
    access_denied: "GitHub sign-in was cancelled.",
    invalid_oauth_state: "Sign-in link expired. Try again.",
    token_exchange_failed: "Could not finish GitHub sign-in. Try again.",
    profile_failed: "Could not read your GitHub profile. Try again.",
    session_claim_failed: "Sign-in finished but the session did not stick. Try again.",
    server_error: "Something went wrong during sign-in. Try again.",
  };
  return map[code] ?? "Sign-in failed. Try again.";
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
    captureAuthTokenFromUrl();
    const params = new URLSearchParams(window.location.search);
    const errCode = params.get("auth_error");
    if (errCode) {
      setAuthError(authErrorMessage(errCode));
      params.delete("auth_error");
      const next = params.toString();
      const url = next
        ? `${window.location.pathname}?${next}`
        : window.location.pathname;
      window.history.replaceState({}, "", url);
    }
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return onUnauthorized(() => {
      clearSessionToken();
      setUser(null);
      setPhase("guest");
      setSessionExpired(true);
    });
  }, []);

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
