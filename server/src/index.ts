import "./polyfill";
import "dotenv/config";
import cors from "cors";
import express from "express";
import { rejectAllAwaiting } from "./awaiting";
import { bus, type HiveEvent } from "./bus";
import {
  disposeAll,
  isCursorConfigured,
  isMainBusy,
  requestCancel,
} from "./pool";
import {
  instructOne,
  runOrchestration,
  spawnSideQuery,
  tryProvideAnswers,
  type TeamMember,
} from "./orchestrate";
import { listConnectedRepos } from "./repos";
import { parseWorkspaceBody } from "./workspace";

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
  const onEvent = (event: HiveEvent) => send(event);
  bus.on("event", onEvent);

  req.on("close", () => {
    bus.off("event", onEvent);
  });
});

app.post("/api/stop", async (_req, res) => {
  rejectAllAwaiting("Stopped by user");
  const cancelled = await requestCancel();
  bus.emitEvent({
    type: "cancelled",
    message: "Stopping… cancelled active work and any waiting questions.",
  });
  res.json({ ok: true, cancelled });
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
  res.json({ ok: true, started: true });
  void runOrchestration(goal, team, workspace)
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
  res.json({ ok: true, started: true });
  void instructOne(member, instruction, team, workspace)
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
