import { useState } from "react";
import type { EngineMode } from "../hooks/useOrchestration";
import { isSoundMuted, toggleSoundMuted } from "../lib/sounds";
import type { ViewMode } from "../types";
import { HiveLogo } from "./HiveLogo";

type Props = {
  view: ViewMode;
  onView: (v: ViewMode) => void;
  engine: EngineMode;
  onEngine: (e: EngineMode) => void;
  apiError: string | null;
};

export function Header({ view, onView, engine, onEngine, apiError }: Props) {
  const [soundOff, setSoundOff] = useState(() => isSoundMuted());

  return (
    <header className="top">
      <div className="brand">
        <div className="brand-lockup">
          <HiveLogo className="brand-mark" />
          <h1>HIVE</h1>
        </div>
        <p id="brandSub">
          {view === "bubbles"
            ? "Your AI crew on a map — instruct any agent in the side chat"
            : "One goal in, the hive reports back"}
        </p>
      </div>
      <div className="top-actions">
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
          {engine === "live"
            ? "Live · Cursor agents"
            : "Demo mode · scripted"}
        </div>
      </div>
    </header>
  );
}
