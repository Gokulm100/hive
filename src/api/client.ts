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
      mode?: "build" | "casual" | "fast";
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
        mode: "build" | "casual" | "fast";
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

export type RunMode = "build" | "casual" | "fast";

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

function onVercelHost(): boolean {
  return (
    typeof window !== "undefined" &&
    /\.vercel\.app$/i.test(window.location.hostname)
  );
}

/**
 * Resolve at call time (not module init) so Vercel hostname is never baked wrong.
 * Local / Vercel: same-origin `/api`. Else: VITE_API_URL or Render.
 */
function apiBase(): string {
  if (onVercelHost()) return "";
  const fromEnv = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (import.meta.env.PROD) return "https://hive-efc7.onrender.com";
  return "";
}

/** Absolute API origin for full-page OAuth navigations. */
function apiOrigin(): string {
  if (onVercelHost()) return window.location.origin;
  const base = apiBase();
  if (base) return base;
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:8787`;
  }
  return "http://localhost:8787";
}

function apiUrl(path: string) {
  return `${apiBase()}${path}`;
}

export type AuthUser = {
  id: string;
  email: string;
  login?: string;
  avatarUrl?: string;
  createdAt: string;
};

const SESSION_TOKEN_KEY = "hive_session_token";

/** Prefer sessionStorage (survives cookie flakes); mirror to localStorage as backup. */
export function getSessionToken(): string | null {
  try {
    const fromSession = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (fromSession) return fromSession;
  } catch {
    /* private mode */
  }
  try {
    const fromLocal = localStorage.getItem(SESSION_TOKEN_KEY);
    if (fromLocal) {
      try {
        sessionStorage.setItem(SESSION_TOKEN_KEY, fromLocal);
      } catch {
        /* ignore */
      }
      return fromLocal;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function setSessionToken(token: string): void {
  try {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearSessionToken(): void {
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * After GitHub OAuth, API redirects to `/#h=…` (hash survives privacy blockers that
 * strip query params like *token*). Legacy `?hive_token=` / `?h=` still accepted.
 */
export function captureAuthTokenFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  let token: string | null = null;

  const params = new URLSearchParams(window.location.search);
  token = params.get("h") || params.get("hive_token");
  if (token) {
    params.delete("h");
    params.delete("hive_token");
    const next = params.toString();
    const path = next
      ? `${window.location.pathname}?${next}`
      : window.location.pathname;
    window.history.replaceState({}, "", path);
  }

  if (!token && window.location.hash.length > 1) {
    const raw = window.location.hash.slice(1);
    const hashParams = new URLSearchParams(raw);
    token = hashParams.get("h") || hashParams.get("hive_token");
    if (!token && raw.startsWith("h=")) {
      token = decodeURIComponent(raw.slice(2));
    }
    if (token) {
      window.history.replaceState(
        {},
        "",
        window.location.pathname + window.location.search
      );
    }
  }

  if (!token) return false;
  setSessionToken(token);
  return true;
}

function authHeaders(): HeadersInit {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const auth = authHeaders() as Record<string, string>;
  for (const [k, v] of Object.entries(auth)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  const res = await fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: "include",
  });
  // Do NOT clear the Bearer token on random 401s (jobs/repos/cold start).
  // That was wiping a fresh GitHub session within seconds. Only /me + logout clear it.
  return res;
}

export function githubAuthUrl(): string {
  // Full-page redirect must hit Express (or Vercel rewrite → Express), never Vite alone.
  return `${apiOrigin()}/api/auth/github`;
}

export async function fetchAuthStatus(): Promise<{ github: boolean }> {
  const res = await fetch(apiUrl("/api/auth/status"), { credentials: "include" });
  if (!res.ok) return { github: false };
  return res.json() as Promise<{ github: boolean }>;
}

export async function fetchAuthMe(): Promise<{ user: AuthUser }> {
  const res = await apiFetch("/api/auth/me");
  const data = (await res.json().catch(() => ({}))) as {
    user?: AuthUser;
    code?: string;
  };
  if (!res.ok) {
    if (data.code === "SESSION_EXPIRED") {
      throw new Error("SESSION_EXPIRED");
    }
    throw new Error("Sign in required");
  }
  if (!data.user) throw new Error("Sign in required");
  return { user: data.user };
}

export async function logout(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } finally {
    clearSessionToken();
  }
}

/** Bypass GitHub — server mints a guest session token. */
export async function loginAsGuest(): Promise<{ user: AuthUser }> {
  const res = await fetch(apiUrl("/api/auth/guest"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  const data = (await res.json().catch(() => ({}))) as {
    user?: AuthUser;
    token?: string;
    error?: string;
  };
  if (!res.ok || !data.user || !data.token) {
    throw new Error(data.error || "Guest sign-in failed");
  }
  setSessionToken(data.token);
  return { user: data.user };
}

export async function fetchHealth(): Promise<Health> {
  const res = await fetch(apiUrl("/api/health"));
  if (!res.ok) throw new Error("API unreachable");
  return res.json() as Promise<Health>;
}

export function subscribeEvents(onEvent: (e: LiveEvent) => void): () => void {
  const token = getSessionToken();
  const qs = token ? `?access_token=${encodeURIComponent(token)}` : "";
  const es = new EventSource(apiUrl(`/api/events${qs}`), {
    withCredentials: true,
  });
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
  if (!res.ok) throw new Error(data.error || `Repos failed (${res.status})`);
  return data.repos ?? [];
}

export type JiraStoryListItem = {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  assignee?: string;
  url: string;
};

export type JiraStoryDetail = JiraStoryListItem & {
  description: string;
  acceptanceCriteria: string;
  goal: string;
};

export type JiraStatus = {
  configured: boolean;
  baseUrl: string | null;
  authOk: boolean | null;
  authError: string | null;
  account: string | null;
  storyTypes: string[];
  defaultJql: string | null;
};

export async function fetchJiraStatus(): Promise<JiraStatus> {
  const res = await apiFetch("/api/jira/status");
  const data = (await res.json().catch(() => ({}))) as Partial<JiraStatus> & {
    error?: string;
  };
  if (!res.ok) {
    return {
      configured: false,
      baseUrl: null,
      authOk: false,
      authError: data.error || `status ${res.status}`,
      account: null,
      storyTypes: [],
      defaultJql: null,
    };
  }
  return {
    configured: Boolean(data.configured),
    baseUrl: data.baseUrl ?? null,
    authOk: data.authOk ?? null,
    authError: data.authError ?? null,
    account: data.account ?? null,
    storyTypes: data.storyTypes ?? [],
    defaultJql: data.defaultJql ?? null,
  };
}

export async function fetchJiraStories(): Promise<JiraStoryListItem[]> {
  const res = await apiFetch("/api/jira/stories");
  const data = (await res.json().catch(() => ({}))) as {
    stories?: JiraStoryListItem[];
    error?: string;
    jql?: string;
  };
  if (!res.ok) throw new Error(data.error || `Jira stories failed (${res.status})`);
  return data.stories ?? [];
}

export async function fetchJiraStory(key: string): Promise<JiraStoryDetail> {
  const res = await apiFetch(`/api/jira/issues/${encodeURIComponent(key)}`);
  const data = (await res.json().catch(() => ({}))) as {
    story?: JiraStoryDetail;
    error?: string;
  };
  if (!res.ok || !data.story) {
    throw new Error(data.error || `Jira issue failed (${res.status})`);
  }
  return data.story;
}

export async function startOrchestration(
  goal: string,
  team: TeamMemberPayload[],
  workspace?: WorkspacePayload | null,
  mode: RunMode = "build"
): Promise<void> {
  const res = await apiFetch("/api/orchestrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal,
      team,
      workspace: workspace || undefined,
      mode,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Orchestrate failed (${res.status})`);
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
    headers: { "Content-Type": "application/json" },
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
  if (!res.ok) throw new Error(data.error || `Instruct failed (${res.status})`);
  return { queued: data.queued };
}

export async function stopRun(): Promise<void> {
  const res = await apiFetch("/api/stop", { method: "POST" });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Stop failed (${res.status})`);
}

export async function skipAgent(agentId: string): Promise<void> {
  const res = await apiFetch("/api/skip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Skip failed (${res.status})`);
}

export async function fetchJobs(): Promise<HiveJobPayload[]> {
  const res = await apiFetch("/api/jobs");
  const data = (await res.json().catch(() => ({}))) as {
    jobs?: HiveJobPayload[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Jobs failed (${res.status})`);
  return data.jobs ?? [];
}

export async function stopJob(id: string): Promise<void> {
  const res = await apiFetch(`/api/jobs/${encodeURIComponent(id)}/stop`, {
    method: "POST",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Stop job failed (${res.status})`);
}

export async function deleteJob(id: string): Promise<void> {
  const res = await apiFetch(`/api/jobs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Delete job failed (${res.status})`);
}

export async function fetchArtifacts(): Promise<HiveArtifactPayload[]> {
  const res = await apiFetch("/api/artifacts");
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
  const res = await apiFetch(`/api/artifacts/${encodeURIComponent(artifact.id)}/download`);
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
    const data = (await del.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Cleanup failed (${del.status})`);
  }
}
