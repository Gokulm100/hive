export type RunMode = "build" | "brainstorm";

export function parseRunMode(raw: unknown): RunMode {
  return String(raw ?? "").toLowerCase() === "brainstorm"
    ? "brainstorm"
    : "build";
}
