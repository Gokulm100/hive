import { useEffect, useState } from "react";
import type { AuthUser, RunMode } from "../api/client";
import type { EngineMode } from "../hooks/useOrchestration";
import { isSoundMuted, toggleSoundMuted } from "../lib/sounds";
import type { ViewMode } from "../types";
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

// Apply before first paint when this module loads
applyTheme(readTheme());

type Props = {
  view: ViewMode;
  onView: (v: ViewMode) => void;
  engine: EngineMode;
  onEngine: (e: EngineMode) => void;
  runMode: RunMode;
  onRunMode: (m: RunMode) => void;
  apiError: string | null;
  authUser: AuthUser | null;
  onSignOut?: () => void;
  onRequestAddAgent?: () => void;
};

export function Header({
  view,
  onView,
  engine,
  onEngine,
  runMode,
  onRunMode,
  apiError,
  authUser,
  onSignOut,
  onRequestAddAgent,
}: Props) {
  const [soundOff, setSoundOff] = useState(() => isSoundMuted());
  const [theme, setTheme] = useState<ThemeMode>(() => readTheme());
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 861px)");
    const onChange = () => {
      if (mq.matches) setMenuOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className="top">
      <div className="brand">
        <div className="brand-lockup">
          <HiveLogo className="brand-mark" />
          <h1>HIVE</h1>
          <button
            type="button"
            className="theme-icon-btn"
            aria-pressed={theme === "light"}
            aria-label={
              theme === "light" ? "Switch to dark mode" : "Switch to light mode"
            }
            title={theme === "light" ? "Dark mode" : "Light mode"}
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? (
              <svg
                className="theme-icon"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M12.1 2.1a1 1 0 0 1 .9 1.1 8 8 0 1 0 7.9 9.4 1 1 0 0 1 1.9.3A10 10 0 1 1 12 2a1 1 0 0 1 .1.1z"
                />
              </svg>
            ) : (
              <svg
                className="theme-icon"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="4" fill="currentColor" />
                <path
                  fill="currentColor"
                  d="M12 1.5a1 1 0 0 1 1 1V4a1 1 0 1 1-2 0V2.5a1 1 0 0 1 1-1zm0 16a1 1 0 0 1 1 1v1.5a1 1 0 1 1-2 0V18.5a1 1 0 0 1 1-1zM4.2 4.2a1 1 0 0 1 1.4 0l1.1 1.1a1 1 0 0 1-1.4 1.4L4.2 5.6a1 1 0 0 1 0-1.4zm13.1 13.1a1 1 0 0 1 1.4 0l1.1 1.1a1 1 0 1 1-1.4 1.4l-1.1-1.1a1 1 0 0 1 0-1.4zM1.5 12a1 1 0 0 1 1-1H4a1 1 0 1 1 0 2H2.5a1 1 0 0 1-1-1zm16 0a1 1 0 0 1 1-1h1.5a1 1 0 1 1 0 2H18.5a1 1 0 0 1-1-1zM4.2 19.8a1 1 0 0 1 0-1.4l1.1-1.1a1 1 0 1 1 1.4 1.4l-1.1 1.1a1 1 0 0 1-1.4 0zm13.1-13.1a1 1 0 0 1 0-1.4l1.1-1.1a1 1 0 1 1 1.4 1.4l-1.1 1.1a1 1 0 0 1-1.4 0z"
                />
              </svg>
            )}
          </button>
        </div>
        <p id="brandSub">
          {runMode === "casual"
            ? "Casual — chat freely; agents assume and don’t ask clarifying questions"
            : runMode === "fast"
                ? "Fast — Dev only: code, commit, merge the PR"
                : view === "bubbles"
                  ? "Your AI crew on a map — instruct any agent in the side chat"
                  : "One goal in, the hive reports back"}
        </p>
      </div>
      <div className="top-end">
        {authUser ? (
          <div className="auth-user-pill">
            {authUser.avatarUrl ? (
              <img
                className="auth-user-avatar"
                src={authUser.avatarUrl}
                alt=""
                width={28}
                height={28}
              />
            ) : null}
            <span className="auth-user-name">
              {authUser.login ?? authUser.email.split("@")[0]}
            </span>
            {onSignOut ? (
              <button type="button" className="auth-sign-out" onClick={onSignOut}>
                Sign out
              </button>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          className="nav-menu-btn"
          aria-expanded={menuOpen}
          aria-controls="top-actions"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>
      <div
        id="top-actions"
        className={`top-actions${menuOpen ? " is-open" : ""}`}
      >
        <div className="view-toggle" role="group" aria-label="Team view">
          <button
            type="button"
            aria-pressed={view === "reports"}
            onClick={() => onView("reports")}
          >
            Reports
          </button>
          <button
            type="button"
            aria-pressed={view === "bubbles"}
            onClick={() => onView("bubbles")}
          >
            Bubbles
          </button>
        </div>
        <div className="view-toggle" role="group" aria-label="Run mode">
          <button
            type="button"
            aria-pressed={runMode === "build"}
            onClick={() => onRunMode("build")}
            title="Full build — implement with needed agents"
          >
            Build
          </button>
          <button
            type="button"
            aria-pressed={runMode === "fast"}
            onClick={() => onRunMode("fast")}
            title="Fast — Dev alone: code, commit, merge PR"
          >
            Fast
          </button>
          <button
            type="button"
            aria-pressed={runMode === "casual"}
            onClick={() => onRunMode("casual")}
            title="Casual chat — assume defaults, no clarifying questions"
          >
            Casual
          </button>
        </div>
        <div className="view-toggle" role="group" aria-label="Engine">
          <button
            type="button"
            aria-pressed={engine === "live"}
            onClick={() => onEngine("live")}
            title={apiError ?? "Cursor SDK · one agent per bubble"}
          >
            Live
          </button>
          <button
            type="button"
            aria-pressed={engine === "demo"}
            onClick={() => onEngine("demo")}
          >
            Demo
          </button>
        </div>
        {onRequestAddAgent ? (
          <button
            type="button"
            className="btn-primary menu-add-agent"
            onClick={() => {
              onRequestAddAgent();
              setMenuOpen(false);
            }}
          >
            Add agent
          </button>
        ) : null}
        <button
          type="button"
          className="btn-ghost sound-toggle"
          aria-pressed={!soundOff}
          title={soundOff ? "Unmute sounds" : "Mute sounds"}
          onClick={() => setSoundOff(toggleSoundMuted())}
        >
          {soundOff ? "Sound off" : "Sound on"}
        </button>
        <div
          className="badge"
          title={apiError ?? undefined}
        >
          {runMode === "casual"
            ? engine === "live"
              ? "Casual · live"
              : "Casual · demo"
            : runMode === "fast"
                ? engine === "live"
                  ? "Fast · Dev only"
                  : "Fast · demo"
                : engine === "live"
                ? "Live · Cursor agents"
                : "Demo mode · scripted"}
        </div>
      </div>
    </header>
  );
}
