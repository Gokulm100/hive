export type HiveArtifactPayload = {
  id: string;
  jobId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  agentId?: string;
};

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
      mode?: "build" | "brainstorm" | "casual";
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
    }
  | {
      type: "jobs";
      jobs: Array<{
        id: string;
        goal: string;
        mode: "build" | "brainstorm" | "casual";
        status: "running" | "done" | "cancelled" | "error";
        summary?: string;
        workspaceUrl?: string | null;
        startedAt: number;
        finishedAt?: number;
      }>;
    }
  | {
      type: "artifact";
      action: "ready" | "deleted";
      artifact: HiveArtifactPayload;
    }
  | {
      type: "artifacts";
      artifacts: HiveArtifactPayload[];
    };

export type RunMode = "build" | "brainstorm" | "casual";

export type HiveJobPayload = {
  id: string;
  goal: string;
  mode: RunMode;
  status: "running" | "done" | "cancelled" | "error";
  summary?: string;
  workspaceUrl?: string | null;
  startedAt: number;
  finishedAt?: number;
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

export type AuthUser = {
  id: string;
  email: string;
  createdAt: string;
};

type ApiErrorPayload = {
  error?: { message?: string; code?: string; details?: Record<string, string> };
};

function apiErrorMessage(data: ApiErrorPayload, fallback: string): string {
  return data.error?.message || fallback;
}

const fetchInit: RequestInit = { credentials: "include" };

/** Local: empty (Vite proxies /api). Prod: Render API unless VITE_API_URL overrides. */
const API_BASE = (
  (import.meta.env.VITE_API_URL as string | undefined)?.trim() ||
  (import.meta.env.PROD ? "https://hive-efc7.onrender.com" : "")
).replace(/\/$/, "");

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

export async function fetchHealth(): Promise<Health> {
  const res = await fetch(apiUrl("/api/health"), fetchInit);
  if (!res.ok) throw new Error("API unreachable");
  return res.json() as Promise<Health>;
}

export async function fetchAuthMe(): Promise<AuthUser | null> {
  const res = await fetch(apiUrl("/api/auth/me"), fetchInit);
  const data = (await res.json().catch(() => ({}))) as {
    user?: AuthUser | null;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(apiErrorMessage(data, "Could not load session"));
  return data.user ?? null;
}

export async function login(
  email: string,
  password: string
): Promise<AuthUser> {
  const res = await fetch(apiUrl("/api/auth/login"), {
    ...fetchInit,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json().catch(() => ({}))) as ApiErrorPayload & {
    user?: AuthUser;
  };
  if (!res.ok) {
    throw new Error(apiErrorMessage(data, `Login failed (${res.status})`));
  }
  if (!data.user) throw new Error("Login failed");
  return data.user;
}

export async function registerAccount(
  email: string,
  password: string
): Promise<AuthUser> {
  const res = await fetch(apiUrl("/api/auth/register"), {
    ...fetchInit,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json().catch(() => ({}))) as ApiErrorPayload & {
    user?: AuthUser;
  };
  if (!res.ok) {
    throw new Error(apiErrorMessage(data, `Sign-up failed (${res.status})`));
  }
  if (!data.user) throw new Error("Sign-up failed");
  return data.user;
}

export async function logout(): Promise<void> {
  const res = await fetch(apiUrl("/api/auth/logout"), {
    ...fetchInit,
    method: "POST",
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiErrorPayload;
    throw new Error(apiErrorMessage(data, "Logout failed"));
  }
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
  const res = await fetch(apiUrl("/api/repos"), fetchInit);
  const data = (await res.json().catch(() => ({}))) as ApiErrorPayload & {
    repos?: ListedRepo[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(
      apiErrorMessage(data, data.error || `Repos failed (${res.status})`)
    );
  }
  return data.repos ?? [];
}

export async function startOrchestration(
  goal: string,
  team: TeamMemberPayload[],
  workspace?: WorkspacePayload | null,
  mode: RunMode = "build"
): Promise<void> {
  const res = await fetch(apiUrl("/api/orchestrate"), {
    ...fetchInit,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal,
      team,
      workspace: workspace || undefined,
      mode,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as ApiErrorPayload & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(
      apiErrorMessage(data, data.error || `Orchestrate failed (${res.status})`)
    );
  }
}

export async function startInstruct(
  member: TeamMemberPayload,
  instruction: string,
  team: TeamMemberPayload[],
  workspace?: WorkspacePayload | null,
  mode: RunMode = "build"
): Promise<{ queued?: boolean }> {
  const res = await fetch(apiUrl("/api/instruct"), {
    ...fetchInit,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      member,
      instruction,
      team,
      workspace: workspace || undefined,
      mode,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as ApiErrorPayload & {
    error?: string;
    queued?: boolean;
  };
  if (!res.ok) {
    throw new Error(
      apiErrorMessage(data, data.error || `Instruct failed (${res.status})`)
    );
  }
  return { queued: data.queued };
}

export async function stopRun(): Promise<void> {
  const res = await fetch(apiUrl("/api/stop"), { ...fetchInit, method: "POST" });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Stop failed (${res.status})`);
}

export async function skipAgent(agentId: string): Promise<void> {
  const res = await fetch(apiUrl("/api/skip"), {
    ...fetchInit,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Skip failed (${res.status})`);
}

export async function fetchJobs(): Promise<HiveJobPayload[]> {
  const res = await fetch(apiUrl("/api/jobs"), fetchInit);
  const data = (await res.json().catch(() => ({}))) as {
    jobs?: HiveJobPayload[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Jobs failed (${res.status})`);
  return data.jobs ?? [];
}

export async function stopJob(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/jobs/${encodeURIComponent(id)}/stop`), {
    ...fetchInit,
    method: "POST",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Stop job failed (${res.status})`);
}

export async function deleteJob(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/jobs/${encodeURIComponent(id)}`), {
    ...fetchInit,
    method: "DELETE",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Delete job failed (${res.status})`);
}

export async function fetchArtifacts(): Promise<HiveArtifactPayload[]> {
  const res = await fetch(apiUrl("/api/artifacts"), fetchInit);
  const data = (await res.json().catch(() => ({}))) as {
    artifacts?: HiveArtifactPayload[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Artifacts failed (${res.status})`);
  return data.artifacts ?? [];
}

export function artifactDownloadUrl(id: string): string {
  return apiUrl(`/api/artifacts/${encodeURIComponent(id)}/download`);
}

/** Download to the browser, then delete the server copy. */
export async function downloadAndDeleteArtifact(
  artifact: HiveArtifactPayload
): Promise<void> {
  const res = await fetch(artifactDownloadUrl(artifact.id), fetchInit);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = artifact.name || "artifact";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }

  const del = await fetch(apiUrl(`/api/artifacts/${encodeURIComponent(artifact.id)}`), {
    ...fetchInit,
    method: "DELETE",
  });
  if (!del.ok) {
    const data = (await del.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Cleanup failed (${del.status})`);
  }
}
