import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from "../auth/session";

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
};

/** Local: empty (Vite proxies /api). Prod: Render API unless VITE_API_URL overrides. */
const API_BASE = (
  (import.meta.env.VITE_API_URL as string | undefined)?.trim() ||
  (import.meta.env.PROD ? "https://hive-efc7.onrender.com" : "")
).replace(/\/$/, "");

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

function apiErrorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const err = (data as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return err;
    if (err && typeof err === "object" && "message" in err) {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === "string" && msg.trim()) return msg;
    }
  }
  return `Request failed (${status})`;
}

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = authHeaders(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(apiUrl(path), { ...init, headers });
}

export async function register(
  email: string,
  password: string
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(apiUrl("/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data, res.status));
  const token = String((data as { token?: string }).token || "");
  const user = (data as { user?: AuthUser }).user;
  if (!token || !user?.id) throw new Error("Invalid sign-up response");
  setAccessToken(token);
  return { token, user };
}

export async function login(
  email: string,
  password: string
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(apiUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data, res.status));
  const token = String((data as { token?: string }).token || "");
  const user = (data as { user?: AuthUser }).user;
  if (!token || !user?.id) throw new Error("Invalid login response");
  setAccessToken(token);
  return { token, user };
}

export async function fetchMe(): Promise<AuthUser> {
  const res = await apiFetch("/api/auth/me");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data, res.status));
  const user = (data as { user?: AuthUser }).user;
  if (!user?.id) throw new Error("Not logged in");
  return user;
}

export function logout(): void {
  clearAccessToken();
}

export async function fetchHealth(): Promise<Health> {
  const res = await fetch(apiUrl("/api/health"));
  if (!res.ok) throw new Error("API unreachable");
  return res.json() as Promise<Health>;
}

export function subscribeEvents(onEvent: (e: LiveEvent) => void): () => void {
  const token = getAccessToken();
  const qs = token
    ? `?access_token=${encodeURIComponent(token)}`
    : "";
  const es = new EventSource(apiUrl(`/api/events${qs}`));
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
  const res = await apiFetch("/api/repos");
  const data = (await res.json().catch(() => ({}))) as {
    repos?: ListedRepo[];
    error?: string;
  };
  if (!res.ok) throw new Error(apiErrorMessage(data, res.status));
  return data.repos ?? [];
}

export async function startOrchestration(
  goal: string,
  team: TeamMemberPayload[],
  workspace?: WorkspacePayload | null,
  mode: RunMode = "build"
): Promise<void> {
  const res = await apiFetch("/api/orchestrate", {
    method: "POST",
    body: JSON.stringify({
      goal,
      team,
      workspace: workspace || undefined,
      mode,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data, res.status));
}

export async function startInstruct(
  member: TeamMemberPayload,
  instruction: string,
  team: TeamMemberPayload[],
  workspace?: WorkspacePayload | null,
  mode: RunMode = "build"
): Promise<{ queued?: boolean }> {
  const res = await apiFetch("/api/instruct", {
    method: "POST",
    body: JSON.stringify({
      member,
      instruction,
      team,
      workspace: workspace || undefined,
      mode,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    queued?: boolean;
  };
  if (!res.ok) throw new Error(apiErrorMessage(data, res.status));
  return { queued: data.queued };
}

export async function stopRun(): Promise<void> {
  const res = await apiFetch("/api/stop", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data, res.status));
}

export async function skipAgent(agentId: string): Promise<void> {
  const res = await apiFetch("/api/skip", {
    method: "POST",
    body: JSON.stringify({ agentId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data, res.status));
}

export async function fetchJobs(): Promise<HiveJobPayload[]> {
  const res = await apiFetch("/api/jobs");
  const data = (await res.json().catch(() => ({}))) as {
    jobs?: HiveJobPayload[];
  };
  if (!res.ok) throw new Error(apiErrorMessage(data, res.status));
  return data.jobs ?? [];
}

export async function stopJob(id: string): Promise<void> {
  const res = await apiFetch(`/api/jobs/${encodeURIComponent(id)}/stop`, {
    method: "POST",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data, res.status));
}

export async function deleteJob(id: string): Promise<void> {
  const res = await apiFetch(`/api/jobs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data, res.status));
}

export async function fetchArtifacts(): Promise<HiveArtifactPayload[]> {
  const res = await apiFetch("/api/artifacts");
  const data = (await res.json().catch(() => ({}))) as {
    artifacts?: HiveArtifactPayload[];
  };
  if (!res.ok) throw new Error(apiErrorMessage(data, res.status));
  return data.artifacts ?? [];
}

export function artifactDownloadUrl(id: string): string {
  const token = getAccessToken();
  const base = apiUrl(`/api/artifacts/${encodeURIComponent(id)}/download`);
  if (!token) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}access_token=${encodeURIComponent(token)}`;
}

/** Download to the browser, then delete the server copy. */
export async function downloadAndDeleteArtifact(
  artifact: HiveArtifactPayload
): Promise<void> {
  const res = await fetch(artifactDownloadUrl(artifact.id));
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

  const del = await apiFetch(`/api/artifacts/${encodeURIComponent(artifact.id)}`, {
    method: "DELETE",
  });
  if (!del.ok) {
    const data = await del.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, del.status));
  }
}
