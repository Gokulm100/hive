import { useEffect, useState } from "react";
import { githubAuthUrl } from "../api/client";
import { HiveLogo } from "./HiveLogo";

const THEME_KEY = "hive-theme";
type ThemeMode = "dark" | "light";

function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return "dark";
}

function applyTheme(mode: ThemeMode) {
  document.body.classList.toggle("theme-light", mode === "light");
  document.body.classList.toggle("theme-dark", mode === "dark");
}

type Mode = "sign-in" | "sign-up";

type Props = {
  sessionExpired: boolean;
  githubEnabled: boolean;
  authError: string | null;
};

export function AuthGate({
  sessionExpired,
  githubEnabled,
  authError,
}: Props) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [theme, setTheme] = useState<ThemeMode>(() => readTheme());

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const headline =
    mode === "sign-in" ? "Sign in to Hive" : "Create your Hive account";
  const subcopy =
    mode === "sign-in"
      ? "Use GitHub to open your workspace and run agents."
      : "Anyone can join. One GitHub account per person.";

  return (
    <div className="auth-gate" role="main">
      {sessionExpired ? (
        <div className="auth-banner" role="status">
          Your session expired. Sign in again to keep using Hive.
        </div>
      ) : null}

      <div className="auth-card">
        <div className="auth-brand">
          <HiveLogo className="auth-logo" />
          <span className="auth-wordmark">HIVE</span>
        </div>

        <h1 className="auth-headline">{headline}</h1>
        <p className="auth-subcopy">{subcopy}</p>

        {authError ? (
          <p className="auth-error" role="alert">
            {authError}
          </p>
        ) : null}

        {!githubEnabled ? (
          <p className="auth-error" role="alert">
            GitHub sign-in is not set up on this server yet.
          </p>
        ) : null}

        <a
          className="auth-github-btn"
          href={githubAuthUrl()}
          aria-disabled={!githubEnabled}
          onClick={(e) => {
            if (!githubEnabled) e.preventDefault();
          }}
        >
          <GitHubIcon />
          Continue with GitHub
        </a>

        <p className="auth-footnote">
          {mode === "sign-in" ? (
            <>
              New here?{" "}
              <button
                type="button"
                className="auth-link"
                onClick={() => setMode("sign-up")}
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                className="auth-link"
                onClick={() => setMode("sign-in")}
              >
                Sign in
              </button>
            </>
          )}
        </p>
        <p className="auth-footnote auth-footnote-muted">
          Sign in and sign up both use the same GitHub button.
        </p>
      </div>

      <button
        type="button"
        className="auth-theme-btn"
        aria-pressed={theme === "light"}
        aria-label={
          theme === "light" ? "Switch to dark mode" : "Switch to light mode"
        }
        onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
      >
        {theme === "light" ? "Dark" : "Light"}
      </button>
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg className="auth-github-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.73.083-.73 1.205.085 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.605-2.665-.303-5.467-1.334-5.467-5.931 0-1.31.468-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23a11.5 11.5 0 0 1 3.003-.404c1.02.005 2.047.138 3.003.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .322.216.694.825.576C20.565 21.796 24 17.299 24 12c0-6.627-5.373-12-12-12z"
      />
    </svg>
  );
}
