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
  artifactOwnedByUser,
  deleteArtifact,
  getArtifact,
  listArtifacts,
  readArtifactBytes,
} from "./artifacts";
import { requireAuth, type AuthedRequest } from "./auth/middleware";
import { authRouter } from "./routes/auth";
import { cancelRunningJobs, deleteJob, getJobForUser, listJobsPublic } from "./jobs";
import { listConnectedRepos } from "./repos";
import { isRunOwnedBy } from "./runOwner";
import { markSkip, SkippedError } from "./skip";
import { eventForUser, initialArtifactsForUser } from "./sseFilter";
import { errorHandler, notFoundHandler, sendError } from "./errors";
import { parseWorkspaceBody } from "./workspace";

// Stale "running" rows from a previous process crash
cancelRunningJobs("Server restarted");

const app = express();
const PORT = Number(
  process.env.PORT || process.env.HIVE_PORT || process.env.NEXUS_PORT || 8787
);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

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

app.use("/api/auth", authRouter);

const api = express.Router();
api.use(requireAuth);

api.get("/repos", async (_req, res) => {
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

api.get("/events", (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: HiveEvent) => {
    const filtered = eventForUser(event, userId);
    if (filtered) {
      res.write(`data: ${JSON.stringify(filtered)}\n\n`);
    }
  };

  send({ type: "status", agentId: "orchestrator", status: "idle" });
  send({ type: "jobs", jobs: listJobsPublic(userId) });
  send({ type: "artifacts", artifacts: initialArtifactsForUser(userId) });
  const onEvent = (event: HiveEvent) => send(event);
  bus.on("event", onEvent);

  req.on("close", () => {
    bus.off("event", onEvent);
  });
});

api.get("/jobs", (req: AuthedRequest, res) => {
  res.json({ jobs: listJobsPublic(req.user!.id) });
});

/** Stop a running job (same as global stop) then keep it in the list as cancelled. */
api.post("/jobs/:id/stop", async (req: AuthedRequest, res) => {
  const id = String(req.params.id || "").trim();
  const job = id ? getJobForUser(id, req.user!.id) : null;
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
api.delete("/jobs/:id", async (req: AuthedRequest, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  const job = getJobForUser(id, req.user!.id);
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

api.get("/artifacts", (req: AuthedRequest, res) => {
  res.json({ artifacts: listArtifacts({ userId: req.user!.id }) });
});

api.get("/artifacts/:id/download", (req: AuthedRequest, res) => {
  const id = String(req.params.id || "").trim();
  if (!id || !artifactOwnedByUser(id, req.user!.id)) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  const meta = getArtifact(id);
  const bytes = readArtifactBytes(id);
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
api.delete("/artifacts/:id", (req: AuthedRequest, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  if (!artifactOwnedByUser(id, req.user!.id)) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  const ok = deleteArtifact(id);
  if (!ok) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  res.json({ ok: true, deleted: id });
});

api.post("/stop", async (req: AuthedRequest, res) => {
  if (!isRunOwnedBy(req.user!.id)) {
    sendError(
      res,
      409,
      "RUN_BUSY",
      "Another account is running a live job on this server"
    );
    return;
  }
  rejectAllAwaiting("Stopped by user");
  const cancelled = await requestCancel("Stopped by user.");
  bus.emitEvent({
    type: "cancelled",
    message: "Stopping… all agents on this job were told to stop.",
  });
  res.json({ ok: true, cancelled });
});

/** Skip one agent/stage; the rest of the run continues. */
api.post("/skip", async (req: AuthedRequest, res) => {
  const agentId = String(req.body?.agentId ?? "").trim();
  if (!agentId) {
    res.status(400).json({ error: "agentId is required" });
    return;
  }
  if (!isRunOwnedBy(req.user!.id)) {
    sendError(
      res,
      409,
      "RUN_BUSY",
      "Another account is running a live job on this server"
    );
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

api.post("/orchestrate", async (req: AuthedRequest, res) => {
  if (!isCursorConfigured()) {
    res.status(503).json({
      error:
        "CURSOR_API_KEY missing. Add it to .env and restart the server.",
    });
    return;
  }

  const userId = req.user!.id;
  const goal = String(req.body?.goal ?? "").trim();
  const team = (req.body?.team ?? []) as TeamMember[];
  const workspace = parseWorkspaceBody(req.body?.workspace);
  const mode = parseRunMode(req.body?.mode);
  if (!goal) {
    res.status(400).json({ error: "goal is required" });
    return;
  }

  if (busy && !isRunOwnedBy(userId)) {
    sendError(
      res,
      409,
      "RUN_BUSY",
      "Another account is running a live job on this server"
    );
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
  void runOrchestration(goal, team, workspace, mode, userId)
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

api.post("/instruct", async (req: AuthedRequest, res) => {
  if (!isCursorConfigured()) {
    res.status(503).json({
      error:
        "CURSOR_API_KEY missing. Add it to .env and restart the server.",
    });
    return;
  }

  const userId = req.user!.id;
  const member = req.body?.member as TeamMember | undefined;
  const instruction = String(req.body?.instruction ?? "").trim();
  const team = (req.body?.team ?? []) as TeamMember[];
  const workspace = parseWorkspaceBody(req.body?.workspace);
  const mode = parseRunMode(req.body?.mode);

  if (!member?.id || !instruction) {
    res.status(400).json({ error: "member and instruction are required" });
    return;
  }

  if (busy && !isRunOwnedBy(userId)) {
    sendError(
      res,
      409,
      "RUN_BUSY",
      "Another account is running a live job on this server"
    );
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
  void instructOne(member, instruction, team, workspace, mode, userId)
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

app.use("/api", api);
app.use(notFoundHandler);
app.use(errorHandler);

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
