export type SubagentSpec = {
  name: string;
  role: string;
  task: string;
};

export function parseSubagentRequest(text: string): SubagentSpec[] | null {
  if (/^\s*NO_SUBAGENTS\s*$/im.test(text.trim())) return [];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      subagents?: unknown;
    };
    if (!Array.isArray(parsed.subagents)) return null;
    return parsed.subagents
      .map((s) => {
        if (!s || typeof s !== "object") return null;
        const o = s as Record<string, unknown>;
        const name = String(o.name ?? "").trim().slice(0, 28);
        const role = String(o.role ?? "Helper").trim().slice(0, 48) || "Helper";
        const task = String(o.task ?? o.brief ?? "").trim();
        if (!name || !task) return null;
        return { name, role, task };
      })
      .filter((s): s is SubagentSpec => !!s)
      .slice(0, 2);
  } catch {
    return null;
  }
}

let seq = 0;

export function nextSubagentId(parentId: string) {
  seq += 1;
  return `sub_${parentId}_${seq}_${Date.now().toString(36)}`;
}
