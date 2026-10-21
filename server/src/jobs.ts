import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bus } from "./bus";
import type { RunMode } from "./runMode";

export type JobStatus = "running" | "done" | "cancelled" | "error";

export type HiveJob = {
  id: string;
  goal: string;
  mode: RunMode;
  status: JobStatus;
  summary?: string;
  workspaceUrl?: string | null;
  startedAt: number;
  finishedAt?: number;
};

const MAX_JOBS = 3;
const STORE_PATH = join(
  process.env.HIVE_CWD?.trim() ||
    process.env.NEXUS_CWD?.trim() ||
    process.cwd(),
  ".hive",
  "jobs.json"
);

let jobs: HiveJob[] = loadJobs();

function loadJobs(): HiveJob[] {
  try {
    if (!existsSync(STORE_PATH)) return [];
    const raw = JSON.parse(readFileSync(STORE_PATH, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((row): row is HiveJob => !!row && typeof row === "object")
      .map((row) => ({
        id: String((row as HiveJob).id || ""),
        goal: String((row as HiveJob).goal || "").trim(),
        mode: parseStoredMode((row as HiveJob).mode),
        status: normalizeStatus((row as HiveJob).status),
        summary: (row as HiveJob).summary
          ? String((row as HiveJob).summary)
          : undefined,
        workspaceUrl: (row as HiveJob).workspaceUrl ?? null,
        startedAt: Number((row as HiveJob).startedAt) || Date.now(),
        finishedAt: (row as HiveJob).finishedAt
          ? Number((row as HiveJob).finishedAt)
          : undefined,
      }))
      .filter((j) => j.id && j.goal)
      .slice(0, MAX_JOBS);
  } catch {
    return [];
  }
}

function normalizeStatus(raw: unknown): JobStatus {
  if (raw === "running" || raw === "done" || raw === "cancelled" || raw === "error") {
    return raw;
  }
  return "done";
}

function parseStoredMode(raw: unknown): RunMode {
  const v = String(raw ?? "").toLowerCase();
  if (v === "brainstorm") return "brainstorm";
  if (v === "casual") return "casual";
  return "build";
}

function persist() {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(jobs, null, 2), "utf8");
  } catch {
    /* ignore disk errors — list still works in-memory */
  }
}

function emitJobs() {
  bus.emitEvent({ type: "jobs", jobs: listJobs() });
}

function trimJobs() {
  while (jobs.length > MAX_JOBS) {
    let dropAt = -1;
    for (let i = jobs.length - 1; i >= 0; i -= 1) {
      if (jobs[i].status !== "running") {
        dropAt = i;
        break;
      }
    }
    if (dropAt < 0) dropAt = jobs.length - 1;
    jobs.splice(dropAt, 1);
  }
}

export function listJobs(): HiveJob[] {
  return jobs.map((j) => ({ ...j }));
}

export function startJob(input: {
  goal: string;
  mode?: RunMode;
  workspaceUrl?: string | null;
}): HiveJob {
  const job: HiveJob = {
    id: randomUUID(),
    goal: input.goal.trim(),
    mode: parseStoredMode(input.mode),
    status: "running",
    workspaceUrl: input.workspaceUrl ?? null,
    startedAt: Date.now(),
  };
  jobs = [job, ...jobs.filter((j) => j.status !== "running")];
  trimJobs();
  persist();
  emitJobs();
  return { ...job };
}

export function finishJob(
  id: string,
  status: Exclude<JobStatus, "running">,
  summary?: string
): HiveJob | null {
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return null;
  const current = jobs[idx];
  if (current.status !== "running") return { ...current };

  const next: HiveJob = {
    ...current,
    status,
    summary: summary?.trim() ? summary.trim().slice(0, 280) : current.summary,
    finishedAt: Date.now(),
  };
  jobs[idx] = next;
  trimJobs();
  persist();
  emitJobs();
  return { ...next };
}

/** Mark any still-running jobs as cancelled (server restart / hard stop). */
export function cancelRunningJobs(message = "Interrupted") {
  let changed = false;
  jobs = jobs.map((j) => {
    if (j.status !== "running") return j;
    changed = true;
    return {
      ...j,
      status: "cancelled" as const,
      summary: message,
      finishedAt: Date.now(),
    };
  });
  if (changed) {
    persist();
    emitJobs();
  }
}

export function getJob(id: string): HiveJob | null {
  const row = jobs.find((j) => j.id === id);
  return row ? { ...row } : null;
}

/** Remove a job from the list (running or finished). */
export function deleteJob(id: string): HiveJob | null {
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return null;
  const [removed] = jobs.splice(idx, 1);
  persist();
  emitJobs();
  return { ...removed };
}
