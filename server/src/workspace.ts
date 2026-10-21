export type WorkspaceTarget = {
  /** GitHub repo URL, e.g. https://github.com/org/repo */
  url: string;
  startingRef?: string;
  autoCreatePR?: boolean;
};

let active: WorkspaceTarget | null = null;

export function setActiveWorkspace(ws: WorkspaceTarget | null) {
  active = ws
    ? {
        url: normalizeRepoUrl(ws.url),
        startingRef: ws.startingRef?.trim() || undefined,
        autoCreatePR: ws.autoCreatePR !== false,
      }
    : null;
}

export function getActiveWorkspace(): WorkspaceTarget | null {
  return active;
}

export function normalizeRepoUrl(raw: string): string {
  let u = raw.trim();
  if (!u) return u;
  // owner/name → https://github.com/owner/name
  if (/^[\w.-]+\/[\w.-]+$/.test(u)) {
    u = `https://github.com/${u}`;
  }
  u = u.replace(/\.git$/i, "").replace(/\/$/, "");
  return u;
}

export function parseWorkspaceBody(body: unknown): WorkspaceTarget | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const url = String(o.url ?? o.repo ?? "").trim();
  if (!url) return null;
  return {
    url: normalizeRepoUrl(url),
    startingRef: String(o.startingRef ?? o.branch ?? "").trim() || undefined,
    autoCreatePR: o.autoCreatePR !== false,
  };
}

export function workspaceHint(ws: WorkspaceTarget | null): string {
  if (!ws?.url) {
    return "Workspace: local server folder (not a GitHub repo). Prefer planning/docs unless asked to edit files.";
  }
  return `Workspace: GitHub repo ${ws.url}${
    ws.startingRef ? ` @ ${ws.startingRef}` : ""
  }.
Do the work in this repository. Commit meaningful changes. ${
    ws.autoCreatePR !== false
      ? "Open a pull request when the work is ready and include the PR URL in your summary."
      : "Push commits when ready and include branch/commit links in your summary."
  }`;
}
