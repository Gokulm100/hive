export type LiveEvent =
  | {
      type: "status";
      agentId: string;
      status: "idle" | "working" | "done" | "blocked";
      report?: string;
    }
  | {
      type: "chat";
      agentId: string;
      role: "user" | "agent" | "system";
      text: string;
    }
  | {
      type: "orch";
      text: string;
      kind?: "summary" | "typing" | "normal";
    }
  | {
      type: "log";
      agentId: string;
      kind: "status" | "report" | "instruct" | "system" | "process";
      text: string;
      status?: "idle" | "working" | "done" | "blocked";
    }
  | { type: "process"; agentId: string; text: string }
  | { type: "run"; running: boolean }
  | { type: "error"; message: string }
  | { type: "done" }
  | { type: "cancelled"; message?: string }
  | { type: "queued"; agentId: string; text: string }
  | {
      type: "awaiting";
      agentId: string;
      waiting: boolean;
      prompt?: string;
      questions?: Array<{
        id: string;
        prompt: string;
        choices: Array<{ id: string; label: string }>;
        allowOther?: boolean;
      }>;
    }
  | {
      type: "success";
      summary: string;
    }
  | {
      type: "subagent";
      action: "spawn" | "done" | "error";
      id: string;
      parentId: string;
      name: string;
      role: string;
      task?: string;
      report?: string;
    }
  | {
      type: "goal";
      goal: string;
      workspace?: { url: string; startingRef?: string } | null;
    }
  | {
      type: "plan";
      goal: string;
      assignments: Array<{ id: string; task: string }>;
    }
  | {
      type: "task";
      agentId: string;
      phase: "active" | "done" | "skipped";
      task?: string;
    };

export type TeamMemberPayload = {
  id: string;
  name: string;
  role: string;
};

export type WorkspacePayload = {
  url: string;
  startingRef?: string;
  autoCreatePR?: boolean;
};

export type ListedRepo = {
  url: string;
  name: string;
};

export type Health = {
  ok: boolean;
  cursor: boolean;
  busy: boolean;
  model: string;
  cwd: string;
};

/** Local: empty (Vite proxies /api). Prod: Render API unless VITE_API_URL overrides. */
const API_BASE = (
  (import.meta.env.VITE_API_URL as string | undefined)?.trim() ||
  (import.meta.env.PROD ? "https://hive-efc7.onrender.com" : "")
).replace(/\/$/, "");

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

export async function fetchHealth(): Promise<Health> {
  const res = await fetch(apiUrl("/api/health"));
  if (!res.ok) throw new Error("API unreachable");
  return res.json() as Promise<Health>;
}

export function subscribeEvents(onEvent: (e: LiveEvent) => void): () => void {
  const es = new EventSource(apiUrl("/api/events"));
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as LiveEvent);
    } catch {
      /* ignore malformed */
    }
  };
  return () => es.close();
}

export async function fetchRepos(): Promise<ListedRepo[]> {
  const res = await fetch(apiUrl("/api/repos"));
  const data = (await res.json().catch(() => ({}))) as {
    repos?: ListedRepo[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Repos failed (${res.status})`);
  return data.repos ?? [];
}

export async function startOrchestration(
  goal: string,
  team: TeamMemberPayload[],
  workspace?: WorkspacePayload | null
): Promise<void> {
  const res = await fetch(apiUrl("/api/orchestrate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal, team, workspace: workspace || undefined }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Orchestrate failed (${res.status})`);
}

export async function startInstruct(
  member: TeamMemberPayload,
  instruction: string,
  team: TeamMemberPayload[],
  workspace?: WorkspacePayload | null
): Promise<{ queued?: boolean }> {
  const res = await fetch(apiUrl("/api/instruct"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      member,
      instruction,
      team,
      workspace: workspace || undefined,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    queued?: boolean;
  };
  if (!res.ok) throw new Error(data.error || `Instruct failed (${res.status})`);
  return { queued: data.queued };
}

export async function stopRun(): Promise<void> {
  const res = await fetch(apiUrl("/api/stop"), { method: "POST" });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Stop failed (${res.status})`);
}
