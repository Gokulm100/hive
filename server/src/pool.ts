import "./polyfill";
import { Agent, CursorAgentError, type Run } from "@cursor/sdk";
import { bus } from "./bus";
import { roleBrief } from "./roles";
import { isSkipped, SkippedError, throwIfSkipped } from "./skip";
import { nextSubagentId, type SubagentSpec } from "./subagents";
import { getActiveWorkspace } from "./workspace";

export { SkippedError };

type AgentHandle = {
  agent: Awaited<ReturnType<typeof Agent.create>>;
  meta: { id: string; name: string; role: string };
  primed: boolean;
  workspaceKey: string;
};

const pool = new Map<string, AgentHandle>();
const activeRuns = new Map<string, Run>();
/** Live Cursor run keyed by Hive agent id (for per-agent skip). */
const runsByAgent = new Map<string, Run>();
/** Parent agent ids currently on a main (non-sub) run */
const mainBusy = new Set<string>();
let cancelRequested = false;

export class CancelledError extends Error {
  constructor(message = "Cancelled by user") {
    super(message);
    this.name = "CancelledError";
  }
}

function apiKey(): string {
  const key = process.env.CURSOR_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "CURSOR_API_KEY is missing. Set it in .env (Dashboard → Integrations)."
    );
  }
  return key;
}

function modelId(): { id: string } {
  return { id: process.env.CURSOR_MODEL?.trim() || "composer-2.5" };
}

function workspaceCwd(): string {
  return (
    process.env.HIVE_CWD?.trim() ||
    process.env.NEXUS_CWD?.trim() ||
    process.cwd()
  );
}

export function clearCancelFlag() {
  cancelRequested = false;
}

export function isCancelRequested() {
  return cancelRequested;
}

export function isMainBusy(agentId?: string) {
  if (agentId) return mainBusy.has(agentId);
  return mainBusy.size > 0;
}

/**
 * Stop every in-flight Cursor run for the current job and mark busy agents idle.
 * Covers main agents, mid-chat helpers, and discuss-mode guests.
 */
export async function requestCancel(
  message = "Stopped by user"
): Promise<number> {
  cancelRequested = true;

  const agentIds = new Set<string>([...mainBusy, ...runsByAgent.keys()]);
  const uniqueRuns = new Map<string, Run>();
  for (const run of activeRuns.values()) uniqueRuns.set(run.id, run);
  for (const run of runsByAgent.values()) uniqueRuns.set(run.id, run);

  let n = 0;
  await Promise.all(
    [...uniqueRuns.values()].map(async (run) => {
      try {
        if (run.supports("cancel")) {
          await run.cancel();
          n += 1;
        }
      } catch {
        /* ignore */
      }
    })
  );

  // Unblock the UI immediately — finally blocks still clean maps
  mainBusy.clear();
  for (const agentId of agentIds) {
    bus.emitEvent({
      type: "status",
      agentId,
      status: "idle",
      report: message,
    });
    bus.emitEvent({
      type: "task",
      agentId,
      phase: "skipped",
      task: message,
    });
    bus.emitEvent({
      type: "log",
      agentId,
      kind: "status",
      text: `Stopped — ${message}`,
      status: "idle",
    });
  }

  return n;
}

/** Cancel only one agent's in-flight run (orchestration continues). */
export async function cancelAgentRun(agentId: string): Promise<boolean> {
  const run = runsByAgent.get(agentId);
  if (!run) return false;
  try {
    if (run.supports("cancel")) {
      await run.cancel();
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function throwIfCancelled() {
  if (cancelRequested) throw new CancelledError();
}

function throwIfAborted(agentId: string) {
  throwIfCancelled();
  throwIfSkipped(agentId);
}

const lastProcessAt = new Map<string, { text: string; at: number }>();

function emitProcess(agentId: string, text: string) {
  const clean = text.trim();
  if (!clean) return;
  const prev = lastProcessAt.get(agentId);
  const now = Date.now();
  // Avoid flooding the detail log with the same heartbeat line
  if (prev && prev.text === clean && now - prev.at < 2500) return;
  lastProcessAt.set(agentId, { text: clean, at: now });
  bus.emitEvent({ type: "process", agentId, text: clean });
  bus.emitEvent({
    type: "log",
    agentId,
    kind: "process",
    text: clean,
  });
}

function workspacePoolKey(agentId: string) {
  const ws = getActiveWorkspace();
  return ws?.url ? `${agentId}::${ws.url}` : `${agentId}::local`;
}

async function createCursorAgent(name: string) {
  const ws = getActiveWorkspace();
  if (ws?.url) {
    return Agent.create({
      apiKey: apiKey(),
      name: `Hive · ${name}`,
      model: modelId(),
      cloud: {
        repos: [
          {
            url: ws.url,
            startingRef: ws.startingRef,
          },
        ],
        autoCreatePR: ws.autoCreatePR !== false,
      },
    });
  }
  return Agent.create({
    apiKey: apiKey(),
    name: `Hive · ${name}`,
    model: modelId(),
    local: {
      cwd: workspaceCwd(),
      settingSources: [],
    },
  });
}

export async function getOrCreateAgent(meta: {
  id: string;
  name: string;
  role: string;
}): Promise<AgentHandle> {
  const key = workspacePoolKey(meta.id);
  const existing = pool.get(key);
  if (existing) return existing;

  // Drop stale handles for this agent id under a different workspace
  for (const [k, h] of pool) {
    if (h.meta.id === meta.id && k !== key) {
      pool.delete(k);
      try {
        await h.agent[Symbol.asyncDispose]();
      } catch {
        /* ignore */
      }
    }
  }

  const agent = await createCursorAgent(meta.name);
  const handle: AgentHandle = {
    agent,
    meta,
    primed: false,
    workspaceKey: key,
  };
  pool.set(key, handle);
  return handle;
}

type RunOpts = {
  /** Mark parent as main-busy (blocks queue; mid-chat uses subagent) */
  asMain?: boolean;
  label?: string;
  streamToChat?: boolean;
};

async function consumeRun(
  agentId: string,
  agentName: string,
  run: Run,
  opts: RunOpts
): Promise<string> {
  activeRuns.set(run.id, run);
  let out = "";
  let lastEmit = 0;
  let pending = "";

  const flushReadable = (force = false) => {
    if (!opts.streamToChat) return;
    const now = Date.now();
    if (!force && now - lastEmit < 700) return;
    const slice = pending.trim();
    if (!slice) return;
    // Prefer full sentences when possible
    const parts = slice.split(/(?<=[.!?])\s+/);
    const ready =
      parts.length > 1 ? parts.slice(0, -1).join(" ") : force ? slice : "";
    if (!ready) return;
    pending = parts.length > 1 ? parts[parts.length - 1] : force ? "" : pending;
    bus.emitEvent({
      type: "chat",
      agentId,
      role: "agent",
      text: ready,
    });
    lastEmit = now;
  };

  try {
    runsByAgent.set(agentId, run);
    throwIfAborted(agentId);
    if (opts.label) emitProcess(agentId, opts.label);

    if (run.supports("stream")) {
      try {
        for await (const event of run.stream()) {
          if (isSkipped(agentId)) {
            if (run.supports("cancel")) await run.cancel();
            throw new SkippedError(agentId);
          }
          if (cancelRequested) {
            if (run.supports("cancel")) await run.cancel();
            throw new CancelledError();
          }
          const ev = event as { type: string; message?: { content?: Array<{ type: string; text?: string }> } };
          if (ev.type === "assistant" && ev.message?.content) {
            for (const block of ev.message.content) {
              if (block.type === "text" && block.text) {
                out += block.text;
                pending += block.text;
                flushReadable(false);
              }
            }
          } else if (ev.type === "tool_call" || ev.type === "thinking") {
            emitProcess(
              agentId,
              `${agentName} is working through the next step…`
            );
          }
        }
      } catch (err) {
        if (err instanceof CancelledError || err instanceof SkippedError) throw err;
      }
    }

    if (isSkipped(agentId)) {
      if (run.supports("cancel")) {
        try {
          await run.cancel();
        } catch {
          /* ignore */
        }
      }
      throw new SkippedError(agentId);
    }

    if (cancelRequested) {
      if (run.supports("cancel")) {
        try {
          await run.cancel();
        } catch {
          /* ignore */
        }
      }
      throw new CancelledError();
    }

    let result: Awaited<ReturnType<Run["wait"]>>;
    try {
      result = await run.wait();
    } catch (err) {
      // Per-agent skip cancels the Cursor run; don't treat that as job-wide stop
      if (isSkipped(agentId)) throw new SkippedError(agentId);
      throw err;
    }

    if (isSkipped(agentId)) {
      throw new SkippedError(agentId);
    }
    if (result.status === "cancelled" || cancelRequested) {
      if (isSkipped(agentId)) throw new SkippedError(agentId);
      throw new CancelledError();
    }
    if (result.status === "error") {
      throw new Error(`${agentName} hit an error while working.`);
    }

    const text = (out || result.result || "").trim();
    if (!text) {
      throw new Error(`${agentName} finished without a readable reply.`);
    }
    flushReadable(true);
    return text;
  } finally {
    activeRuns.delete(run.id);
    if (runsByAgent.get(agentId) === run) runsByAgent.delete(agentId);
  }
}

export async function runAgentPrompt(
  meta: { id: string; name: string; role: string },
  prompt: string,
  opts: RunOpts = {}
): Promise<string> {
  throwIfAborted(meta.id);
  const asMain = opts.asMain !== false;
  if (asMain) mainBusy.add(meta.id);

  try {
    const handle = await getOrCreateAgent(meta);
    const brief = roleBrief(meta.id, meta.name, meta.role);
    const full = handle.primed ? prompt : `${brief}\n\n---\n\n${prompt}`;

    emitProcess(
      meta.id,
      opts.label || `${meta.name} is thinking about the request…`
    );

    const run = await handle.agent.send(full);
    const text = await consumeRun(meta.id, meta.name, run, {
      ...opts,
      streamToChat: opts.streamToChat ?? false,
    });
    handle.primed = true;
    return text;
  } finally {
    if (asMain) mainBusy.delete(meta.id);
  }
}

function emitSubagent(
  action: "spawn" | "done" | "error",
  payload: {
    id: string;
    parentId: string;
    name: string;
    role: string;
    task?: string;
    report?: string;
  }
) {
  bus.emitEvent({ type: "subagent", action, ...payload });
}

/** Fresh Cursor agent with its own bubble id; streams to that id */
async function runEphemeralAgent(opts: {
  id: string;
  parentId: string;
  name: string;
  role: string;
  task: string;
  prompt: string;
}): Promise<string> {
  throwIfCancelled();

  emitSubagent("spawn", {
    id: opts.id,
    parentId: opts.parentId,
    name: opts.name,
    role: opts.role,
    task: opts.task,
  });
  bus.emitEvent({
    type: "status",
    agentId: opts.id,
    status: "working",
    report: opts.task,
  });
  bus.emitEvent({
    type: "chat",
    agentId: opts.id,
    role: "system",
    text: `Helper for ${opts.parentId} — on it.`,
  });
  bus.emitEvent({
    type: "chat",
    agentId: opts.id,
    role: "user",
    text: opts.task,
  });
  bus.emitEvent({
    type: "log",
    agentId: opts.id,
    kind: "instruct",
    text: opts.task,
  });

  const agent = await createCursorAgent(opts.name);

  try {
    const run = await agent.send(opts.prompt);
    const text = await consumeRun(opts.id, opts.name, run, {
      asMain: false,
      streamToChat: true,
      label: `${opts.name} is working…`,
    });

    bus.emitEvent({
      type: "status",
      agentId: opts.id,
      status: "done",
      report: "Finished.",
    });
    emitSubagent("done", {
      id: opts.id,
      parentId: opts.parentId,
      name: opts.name,
      role: opts.role,
      task: opts.task,
      report: text.slice(0, 600),
    });
    return text;
  } catch (err) {
    if (err instanceof CancelledError) {
      bus.emitEvent({
        type: "status",
        agentId: opts.id,
        status: "idle",
        report: "Stopped with the job.",
      });
      emitSubagent("done", {
        id: opts.id,
        parentId: opts.parentId,
        name: opts.name,
        role: opts.role,
        task: opts.task,
        report: "Stopped with the job.",
      });
      throw err;
    }
    const msg = explainCursorError(err);
    bus.emitEvent({
      type: "status",
      agentId: opts.id,
      status: "blocked",
      report: msg,
    });
    bus.emitEvent({
      type: "chat",
      agentId: opts.id,
      role: "system",
      text: msg,
    });
    emitSubagent("error", {
      id: opts.id,
      parentId: opts.parentId,
      name: opts.name,
      role: opts.role,
      task: opts.task,
      report: msg,
    });
    throw err;
  } finally {
    try {
      await agent[Symbol.asyncDispose]();
    } catch {
      /* ignore */
    }
  }
}

/** User mid-chat side helper — pops in as a bubble, leaves when done */
export async function runSubagentQuery(
  parent: { id: string; name: string; role: string },
  query: string
): Promise<string> {
  const id = nextSubagentId(parent.id);
  const name = `${parent.name} · helper`;
  const role = `Side helper for ${parent.name}`;

  bus.emitEvent({
    type: "chat",
    agentId: parent.id,
    role: "system",
    text: `Spawning ${name} as a temporary bubble (main work keeps going)…`,
  });

  const brief = roleBrief(parent.id, parent.name, parent.role);
  try {
    const text = await runEphemeralAgent({
      id,
      parentId: parent.id,
      name,
      role,
      task: query,
      prompt: `${brief}

You are a temporary side helper for ${parent.name}. The main ${parent.name} may still be working on something else — answer ONLY this side question. Do not redo the whole project. Use plain human language.

Side question from the user:
${query}`,
    });

    bus.emitEvent({
      type: "chat",
      agentId: parent.id,
      role: "system",
      text: `${name} finished and will leave the map.`,
    });
    bus.emitEvent({
      type: "chat",
      agentId: parent.id,
      role: "agent",
      text: `Helper report:\n\n${text.slice(0, 1200)}`,
    });
    return text;
  } catch (err) {
    if (err instanceof CancelledError) throw err;
    bus.emitEvent({
      type: "chat",
      agentId: parent.id,
      role: "system",
      text: `Side helper failed: ${explainCursorError(err)}`,
    });
    throw err;
  }
}

/** Parent-requested specialists — run in parallel, each as its own bubble */
export async function runRequestedSubagents(
  parent: { id: string; name: string; role: string },
  specs: SubagentSpec[]
): Promise<{ name: string; role: string; task: string; report: string }[]> {
  if (!specs.length) return [];

  bus.emitEvent({
    type: "chat",
    agentId: parent.id,
    role: "system",
    text: `${parent.name} is bringing in ${specs.length} temporary helper${specs.length > 1 ? "s" : ""}…`,
  });

  const jobs = specs.map(async (spec) => {
    const id = nextSubagentId(parent.id);
    const prompt = `You are ${spec.name} (${spec.role}), a temporary specialist helping ${parent.name}.

Complete ONLY this task. Do not expand scope.
Plain language. Short, useful output.

Task:
${spec.task}`;

    try {
      const report = await runEphemeralAgent({
        id,
        parentId: parent.id,
        name: spec.name,
        role: spec.role,
        task: spec.task,
        prompt,
      });
      return { ...spec, report };
    } catch (err) {
      if (err instanceof CancelledError) throw err;
      return {
        ...spec,
        report: `(helper failed: ${explainCursorError(err)})`,
      };
    }
  });

  return Promise.all(jobs);
}

export function isCursorConfigured(): boolean {
  return Boolean(process.env.CURSOR_API_KEY?.trim());
}

export function explainCursorError(err: unknown): string {
  if (err instanceof CancelledError) return err.message;
  if (err instanceof CursorAgentError) {
    return `Cursor startup failed: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function disposeAll(): Promise<void> {
  await requestCancel();
  const handles = [...pool.values()];
  pool.clear();
  activeRuns.clear();
  mainBusy.clear();
  await Promise.all(
    handles.map(async (h) => {
      try {
        await h.agent[Symbol.asyncDispose]();
      } catch {
        /* ignore */
      }
    })
  );
}
