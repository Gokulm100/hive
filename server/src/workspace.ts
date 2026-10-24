import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type WorkspaceTarget = {
  /** GitHub repo URL, e.g. https://github.com/org/repo */
  url?: string;
  /** Absolute folder on this computer for local Cursor agents */
  localPath?: string;
  startingRef?: string;
  autoCreatePR?: boolean;
};

let active: WorkspaceTarget | null = null;

export function defaultLocalCwd(): string {
  return (
    process.env.HIVE_CWD?.trim() ||
    process.env.NEXUS_CWD?.trim() ||
    process.cwd()
  );
}

/** Expand ~ and require an existing directory on this computer. */
export function assertLocalDir(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Local folder path is empty");
  }
  const expanded = trimmed.replace(/^~(?=$|[/\\])/, homedir());
  const abs = resolve(expanded);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(
      `Local folder not found on this computer: ${abs}. Run Hive API locally (npm run dev) and pick a folder that exists here.`
    );
  }
  return abs;
}

export function setActiveWorkspace(ws: WorkspaceTarget | null) {
  if (!ws) {
    active = null;
    return;
  }
  if (ws.localPath) {
    active = {
      localPath: ws.localPath,
      autoCreatePR: false,
    };
    return;
  }
  if (ws.url) {
    active = {
      url: normalizeRepoUrl(ws.url),
      startingRef: ws.startingRef?.trim() || undefined,
      autoCreatePR: ws.autoCreatePR !== false,
    };
    return;
  }
  active = null;
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
  const localPath = String(o.localPath ?? o.cwd ?? "").trim();
  if (localPath) {
    return {
      localPath,
      autoCreatePR: false,
    };
  }
  const url = String(o.url ?? o.repo ?? "").trim();
  if (!url) return null;
  return {
    url: normalizeRepoUrl(url),
    startingRef: String(o.startingRef ?? o.branch ?? "").trim() || undefined,
    autoCreatePR: o.autoCreatePR !== false,
  };
}

/** Validate local paths; pass through GitHub workspaces. */
export function resolveWorkspace(
  ws: WorkspaceTarget | null
): WorkspaceTarget | null {
  if (!ws) return null;
  if (ws.localPath) {
    return {
      localPath: assertLocalDir(ws.localPath),
      autoCreatePR: false,
    };
  }
  if (ws.url) {
    return {
      url: normalizeRepoUrl(ws.url),
      startingRef: ws.startingRef?.trim() || undefined,
      autoCreatePR: ws.autoCreatePR !== false,
    };
  }
  return null;
}

export function workspaceHint(ws: WorkspaceTarget | null): string {
  if (ws?.localPath) {
    return `Workspace: local folder on this computer — ${ws.localPath}.
Edit files in this directory. Commit when useful if it is a git repo. Include paths of changed files in your summary.`;
  }
  if (!ws?.url) {
    return "Workspace: default local folder on this computer (not a GitHub repo). Prefer planning/docs unless asked to edit files.";
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

export function workspaceDisplay(ws: WorkspaceTarget | null): string | null {
  if (ws?.localPath) return ws.localPath;
  if (ws?.url) return ws.url;
  return null;
}
