export type EngineMode = "live" | "demo";

/** Replay demo is only offered after the user picks Demo in the header toggle. */
export function showReplayDemoButton(
  engine: EngineMode,
  userPickedDemo: boolean
): boolean {
  return engine === "demo" && userPickedDemo;
}
