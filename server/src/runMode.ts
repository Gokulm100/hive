export type RunMode = "build" | "brainstorm" | "casual" | "fast";

export function parseRunMode(raw: unknown): RunMode {
  const v = String(raw ?? "").toLowerCase();
  if (v === "brainstorm") return "brainstorm";
  if (v === "casual") return "casual";
  if (v === "fast") return "fast";
  return "build";
}

/** Discussion-only modes (no implementation). */
export function isDiscussMode(mode: RunMode): boolean {
  return mode === "brainstorm" || mode === "casual";
}

/** Dev-only: implement, commit, merge — skip the rest of the crew. */
export function isFastMode(mode: RunMode): boolean {
  return mode === "fast";
}
