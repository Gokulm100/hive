export type RunMode = "build" | "brainstorm" | "casual";

export function parseRunMode(raw: unknown): RunMode {
  const v = String(raw ?? "").toLowerCase();
  if (v === "brainstorm") return "brainstorm";
  if (v === "casual") return "casual";
  return "build";
}

/** Discussion-only modes (no implementation). */
export function isDiscussMode(mode: RunMode): boolean {
  return mode === "brainstorm" || mode === "casual";
}
