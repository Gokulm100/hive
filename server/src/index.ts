import "./polyfill";
import "dotenv/config";
import cors from "cors";
import express from "express";
import { rejectAllAwaiting, rejectAwaiting } from "./awaiting";
import { bus, type HiveEvent } from "./bus";
import {
  cancelAgentRun,
  disposeAll,
  isCursorConfigured,
  isMainBusy,
  requestCancel,
} from "./pool";
import {
  instructOne,
  parseRunMode,
  runOrchestration,
  spawnSideQuery,
  tryProvideAnswers,
  type TeamMember,
} from "./orchestrate";
import {
  deleteArtifact,
  getArtifact,
  listArtifacts,
  readArtifactBytes,
} from "./artifacts";
import { cancelRunningJobs, deleteJob, getJob, listJobs } from "./jobs";
import { listConnectedRepos } from "./repos";
import { markSkip, SkippedError } from "./skip";
import { parseWorkspaceBody } from "./workspace";
import { requireAuth } from "./auth/session";
import { authRouter } from "./routes/auth";

// Stale "running" rows from a previous process crash
cancelRunningJobs("Server restarted");

const app = express();
const PORT = Number(
  process.env.PORT || process.env.HIVE_PORT || process.env.NEXUS_PORT || 8787
);

// Needed on Render so req.secure / proto match the public https URL
app.set("trust proxy", 1);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

app.use("/api/auth", authRouter);

app.use((req, res, next) => {
  const path = req.path;
  if (!path.startsWith("/api/")) return next();
  if (path === "/api/health") return next();
  if (path.startsWith("/api/auth")) return next();
  requireAuth(req, res, next);
});

let busy = false;

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    cursor: isCursorConfigured(),
    busy,
    model: process.env.CURSOR_MODEL || "composer-2.5",
    cwd: process.env.HIVE_CWD || process.env.NEXUS_CWD || process.cwd(),
  });
});

app.get("/api/repos", async (_req, res) => {
  if (!isCursorConfigured()) {
    res.status(503).json({ error: "CURSOR_API_KEY missing", repos: [] });
    return;
  }
  try {
    const repos = await listConnectedRepos();
    res.json({ repos });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
      repos: [],
    });
  }
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: HiveEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  send({ type: "status", agentId: "orchestrator", status: "idle" });
  send({ type: "jobs", jobs: listJobs() });
  send({ type: "artifacts", artifacts: listArtifacts() });
  const onEvent = (event: HiveEvent) => send(event);
  bus.on("event", onEvent);

  req.on("close", () => {
    bus.off("event", onEvent);
  });
});

app.get("/api/jobs", (_req, res) => {
  res.json({ jobs: listJobs() });
});

/** Stop a running job (same as global stop) then keep it in the list as cancelled. */
app.post("/api/jobs/:id/stop", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const job = id ? getJob(id) : null;
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "running") {
    res.json({ ok: true, id, alreadyFinished: true, status: job.status });
    return;
  }
  rejectAllAwaiting("Stopped by user");
  const cancelled = await requestCancel("Stopped with this job.");
  bus.emitEvent({
    type: "cancelled",
    message:
      "Stopping job… all agents on this job were told to stop.",
  });
  res.json({ ok: true, id, cancelled });
});

/** Delete a job from history. If it is still running, stop it first. */
app.delete("/api/jobs/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  const job = getJob(id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status === "running") {
    rejectAllAwaiting("Job deleted");
    await requestCancel("Job deleted — all agents stopped.");
    bus.emitEvent({
      type: "cancelled",
      message: "Job deleted — all agents on that job were stopped.",
    });
  }
  const removed = deleteJob(id);
  if (!removed) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({ ok: true, deleted: id, wasRunning: job.status === "running" });
});

app.get("/api/artifacts", (_req, res) => {
  res.json({ artifacts: listArtifacts() });
});

app.get("/api/artifacts/:id/download", (req, res) => {
  const id = String(req.params.id || "").trim();
  const meta = getArtifact(id);
  const bytes = id ? readArtifactBytes(id) : null;
  if (!meta || !bytes) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  res.setHeader("Content-Type", meta.mime);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${meta.name.replace(/"/g, "")}"`
  );
  res.setHeader("Content-Length", String(bytes.length));
  res.send(bytes);
});

/** Client calls this after a successful browser download. */
app.delete("/api/artifacts/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  const ok = deleteArtifact(id);
  if (!ok) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  res.json({ ok: true, deleted: id });
});

app.post("/api/stop", async (_req, res) => {
  rejectAllAwaiting("Stopped by user");
  const cancelled = await requestCancel("Stopped by user.");
  bus.emitEvent({
    type: "cancelled",
    message: "Stopping… all agents on this job were told to stop.",
  });
  res.json({ ok: true, cancelled });
});

/** Skip one agent/stage; the rest of the run continues. */
app.post("/api/skip", async (req, res) => {
  const agentId = String(req.body?.agentId ?? "").trim();
  if (!agentId) {
    res.status(400).json({ error: "agentId is required" });
    return;
  }

  markSkip(agentId);
  rejectAwaiting(agentId, new SkippedError(agentId));
  const cancelledRun = await cancelAgentRun(agentId);

  bus.emitEvent({
    type: "task",
    agentId,
    phase: "skipped",
  });
  bus.emitEvent({
    type: "status",
    agentId,
    status: "idle",
    report: "Skipped.",
  });
  bus.emitEvent({
    type: "chat",
    agentId,
    role: "system",
    text: "Skipped — moving on to the next stage.",
  });
  bus.emitEvent({
    type: "orch",
    text: `Skipping ${agentId}…`,
    kind: "normal",
  });

  res.json({ ok: true, agentId, cancelledRun });
});

app.post("/api/orchestrate", async (req, res) => {
  if (!isCursorConfigured()) {
    res.status(503).json({
      error:
        "CURSOR_API_KEY missing. Add it to .env and restart the server.",
    });
    return;
  }

  const goal = String(req.body?.goal ?? "").trim();
  const team = (req.body?.team ?? []) as TeamMember[];
  const workspace = parseWorkspaceBody(req.body?.workspace);
  const mode = parseRunMode(req.body?.mode);
  if (!goal) {
    res.status(400).json({ error: "goal is required" });
    return;
  }

  // Mid-flight new goal → side helper on Orchestrator (don't wait)
  if (busy) {
    void spawnSideQuery(
      {
        id: "orchestrator",
        name: "Orchestrator",
        role: "Routes work to the team",
      },
      goal
    );
    res.json({ ok: true, subagent: true });
    return;
  }

  busy = true;
  res.json({ ok: true, started: true, mode });
  void runOrchestration(goal, team, workspace, mode)
    .catch((err) => {
      bus.emitEvent({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      busy = false;
    });
});

app.post("/api/instruct", async (req, res) => {
  if (!isCursorConfigured()) {
    res.status(503).json({
      error:
        "CURSOR_API_KEY missing. Add it to .env and restart the server.",
    });
    return;
  }

  const member = req.body?.member as TeamMember | undefined;
  const instruction = String(req.body?.instruction ?? "").trim();
  const team = (req.body?.team ?? []) as TeamMember[];
  const workspace = parseWorkspaceBody(req.body?.workspace);
  const mode = parseRunMode(req.body?.mode);

  if (!member?.id || !instruction) {
    res.status(400).json({ error: "member and instruction are required" });
    return;
  }

  // 1) Answering clarifying questions for that agent
  if (tryProvideAnswers(member.id, instruction)) {
    res.json({ ok: true, answered: true });
    return;
  }

  // 2) Main work in flight for this agent (or whole run) → spawn side helper now
  if (busy || isMainBusy(member.id)) {
    void spawnSideQuery(member, instruction);
    res.json({ ok: true, subagent: true });
    return;
  }

  // 3) Fresh main instruct / orchestrate
  busy = true;
  res.json({ ok: true, started: true, mode });
  void instructOne(member, instruction, team, workspace, mode)
    .catch((err) => {
      bus.emitEvent({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      busy = false;
    });
});

const server = app.listen(PORT, () => {
  console.log(`Hive API http://localhost:${PORT}`);
  console.log(
    isCursorConfigured()
      ? "Cursor key detected — live agents enabled"
      : "No CURSOR_API_KEY — set .env before running live"
  );
});

async function shutdown() {
  rejectAllAwaiting("Server shutting down");
  await disposeAll();
  server.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
