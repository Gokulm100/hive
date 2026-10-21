import { provideAnswers, waitForAnswers } from "./awaiting";
import { bus } from "./bus";
import { parseStructuredQuestions } from "./questions";
import { BUILTIN_ROLES, roleBrief } from "./roles";
import {
  CancelledError,
  clearCancelFlag,
  explainCursorError,
  isMainBusy,
  runAgentPrompt,
  runRequestedSubagents,
  runSubagentQuery,
  SkippedError,
  throwIfCancelled,
} from "./pool";
import { parseSubagentRequest } from "./subagents";
import { parseRunMode, type RunMode } from "./runMode";
import { clearSkipped, isSkipped } from "./skip";
import { finishJob, startJob } from "./jobs";
import {
  getActiveWorkspace,
  setActiveWorkspace,
  workspaceHint,
  type WorkspaceTarget,
} from "./workspace";

export type TeamMember = {
  id: string;
  name: string;
  role: string;
};

export type { WorkspaceTarget, RunMode };
export { parseRunMode };

type Assignment = { id: string; task: string };

type BrainstormGuest = {
  name: string;
  role: string;
  focus: string;
};

type BrainstormPlan = {
  assignments: Assignment[];
  guests: BrainstormGuest[];
};

function humanStatus(status: string) {
  switch (status) {
    case "working":
      return "Working";
    case "done":
      return "Done";
    case "blocked":
      return "Waiting on you";
    default:
      return "Idle";
  }
}

function emitStatus(
  agentId: string,
  status: "idle" | "working" | "done" | "blocked",
  report?: string
) {
  bus.emitEvent({ type: "status", agentId, status, report });
  bus.emitEvent({
    type: "log",
    agentId,
    kind: "status",
    text: humanStatus(status) + (report ? ` — ${report}` : ""),
    status,
  });
  if (report) {
    bus.emitEvent({
      type: "log",
      agentId,
      kind: "report",
      text: report,
      status,
    });
  }
}

function emitSkipped(
  member: { id: string; name: string },
  task?: string
) {
  emitStatus(member.id, "idle", "Skipped.");
  bus.emitEvent({
    type: "task",
    agentId: member.id,
    phase: "skipped",
    task,
  });
  bus.emitEvent({
    type: "chat",
    agentId: member.id,
    role: "system",
    text: "Skipped — moving on to the next stage.",
  });
  bus.emitEvent({
    type: "orch",
    text: `Skipped ${member.name}.`,
    kind: "normal",
  });
}

function extractJson(text: string): Assignment[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      assignments?: Assignment[];
    };
    if (!Array.isArray(parsed.assignments)) return null;
    return parsed.assignments.filter(
      (a) => a && typeof a.id === "string" && typeof a.task === "string"
    );
  } catch {
    return null;
  }
}

function defaultAssignments(
  goal: string,
  team: TeamMember[],
  mode: RunMode
): Assignment[] {
  const pool = team.filter((t) => t.id !== "orchestrator");
  // Brainstorm: lean default — manager + bd only if present
  const leanIds =
    mode === "brainstorm"
      ? ["manager", "bd", "designer"].filter((id) =>
          pool.some((p) => p.id === id)
        )
      : pool.map((p) => p.id);
  const ids = leanIds.length ? leanIds.slice(0, 3) : pool.slice(0, 2).map((p) => p.id);
  return pool
    .filter((t) => ids.includes(t.id))
    .map((t) => ({
      id: t.id,
      task:
        mode === "brainstorm"
          ? `Brainstorm only (no implementation) for “${goal}” as ${t.name} (${t.role}). Share ideas, risks, and options.`
          : `For the goal “${goal}”, do your job as ${t.name} (${t.role}).`,
    }));
}

function extractBrainstormPlan(
  text: string,
  team: TeamMember[],
  goal: string
): BrainstormPlan {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        participants?: unknown;
        assignments?: unknown;
        guests?: unknown;
      };
      const source = Array.isArray(parsed.participants)
        ? parsed.participants
        : parsed.assignments;
      const assignments: Assignment[] = [];
      if (Array.isArray(source)) {
        for (const row of source) {
          if (!row || typeof row !== "object") continue;
          const o = row as Record<string, unknown>;
          const id = String(o.id ?? "").trim();
          const task = String(o.focus ?? o.task ?? "").trim();
          if (!id || !task) continue;
          if (!team.some((t) => t.id === id) || id === "orchestrator") continue;
          assignments.push({ id, task });
        }
      }
      const guests: BrainstormGuest[] = [];
      if (Array.isArray(parsed.guests)) {
        for (const g of parsed.guests.slice(0, 2)) {
          if (!g || typeof g !== "object") continue;
          const o = g as Record<string, unknown>;
          const name = String(o.name ?? "").trim().slice(0, 28);
          const role = String(o.role ?? "Specialist").trim().slice(0, 48);
          const focus = String(o.focus ?? o.task ?? "").trim();
          if (!name || !focus) continue;
          guests.push({ name, role: role || "Specialist", focus });
        }
      }
      if (assignments.length || guests.length) {
        return {
          assignments: assignments.slice(0, 4),
          guests,
        };
      }
    } catch {
      /* fall through */
    }
  }
  return {
    assignments: defaultAssignments(goal, team, "brainstorm"),
    guests: [],
  };
}

async function askThenImplement(
  member: TeamMember,
  task: string,
  goal: string
): Promise<string> {
  throwIfCancelled();

  emitStatus(
    member.id,
    "working",
    `${member.name} is checking what they need to know first…`
  );
  bus.emitEvent({
    type: "chat",
    agentId: member.id,
    role: "system",
    text: `${member.name} will ask any clarifying questions before doing the work.`,
  });

  const wsNote = workspaceHint(getActiveWorkspace());

  const askPrompt = `${roleBrief(member.id, member.name, member.role)}

${wsNote}

Overall goal: ${goal}

Your assignment:
${task}

STEP 1 — Clarifying choices only. Do NOT implement yet.

Reply with ONLY JSON (no markdown prose outside the JSON) in this exact shape:
{
  "questions": [
    {
      "id": "q1",
      "prompt": "Short, human-readable question a non-technical person can answer?",
      "choices": [
        { "id": "a", "label": "Clear option A" },
        { "id": "b", "label": "Clear option B" },
        { "id": "c", "label": "Clear option C" }
      ],
      "allowOther": true
    }
  ]
}

Rules for questions:
- Max 3 questions
- Each prompt must be plain English, one decision per question
- Each question needs 2–4 concrete choices (radio-button ready)
- Choices must be mutually distinct and actionable (not vague)
- Prefer product/brand/scope decisions over technical jargon
- Set allowOther true unless a forced pick is required
- If you truly need nothing, reply with exactly: NO_QUESTIONS`;

  const askText = await runAgentPrompt(member, askPrompt, {
    asMain: true,
    label: `${member.name} is preparing questions…`,
    streamToChat: false,
  });

  const questions = parseStructuredQuestions(askText);
  let answers = "No extra answers — proceed with reasonable assumptions.";

  if (questions && questions.length > 0) {
    const promptText = [
      "Before I start, I need a few quick choices from you:",
      "",
      ...questions.map((q, i) => {
        const opts = q.choices.map((c) => `   • ${c.label}`).join("\n");
        return `${i + 1}. ${q.prompt}\n${opts}`;
      }),
      "",
      "Use the form below — pick one option per question (optional notes welcome).",
    ].join("\n");

    bus.emitEvent({
      type: "chat",
      agentId: member.id,
      role: "agent",
      text: promptText,
    });
    emitStatus(member.id, "blocked", "Waiting for your answers before starting.");
    bus.emitEvent({
      type: "awaiting",
      agentId: member.id,
      waiting: true,
      prompt: promptText,
      questions,
    });

    try {
      answers = await waitForAnswers(member.id);
      bus.emitEvent({
        type: "chat",
        agentId: member.id,
        role: "system",
        text: "Thanks — continuing with your answers.",
      });
    } finally {
      bus.emitEvent({
        type: "awaiting",
        agentId: member.id,
        waiting: false,
      });
    }
  } else {
    bus.emitEvent({
      type: "chat",
      agentId: member.id,
      role: "agent",
      text:
        questions === null
          ? askText
          : "I have enough to start — no clarifying questions.",
    });
  }

  throwIfCancelled();
  emitStatus(
    member.id,
    "working",
    `${member.name} is deciding if helpers are needed…`
  );

  const helperAsk = `${roleBrief(member.id, member.name, member.role)}

${wsNote}

Overall goal: ${goal}

Your assignment:
${task}

User answers / guidance:
${answers}

STEP — Temporary helpers (optional). Do NOT implement the assignment yet.

If you need up to 2 short-lived specialists to help (research, copy, review, etc.), reply ONLY with JSON:
{"subagents":[{"name":"Short name","role":"what they do","task":"exact task for them"}]}

Rules:
- Only spawn helpers when they clearly speed things up
- Each task must be small and concrete
- Prefer doing the work yourself when you can
- If you need none, reply exactly: NO_SUBAGENTS`;

  const helperText = await runAgentPrompt(member, helperAsk, {
    asMain: true,
    label: `${member.name} is checking for helpers…`,
    streamToChat: false,
  });

  const helperSpecs = parseSubagentRequest(helperText) ?? [];
  let helperDigest = "(no helpers)";
  if (helperSpecs.length > 0) {
    const reports = await runRequestedSubagents(member, helperSpecs);
    helperDigest = reports
      .map(
        (r) =>
          `### ${r.name} (${r.role})\nTask: ${r.task}\nResult:\n${r.report}`
      )
      .join("\n\n");
    bus.emitEvent({
      type: "chat",
      agentId: member.id,
      role: "system",
      text: `Helpers finished — ${member.name} is continuing with their notes.`,
    });
  }

  throwIfCancelled();
  emitStatus(member.id, "working", `${member.name} is doing the work now…`);

  const implementPrompt = `${roleBrief(member.id, member.name, member.role)}

${wsNote}

Overall goal: ${goal}

Your assignment:
${task}

User answers / guidance:
${answers}

Notes from temporary helpers (if any):
${helperDigest}

Now implement / complete the assignment yourself in the workspace above. Use helper notes where useful. Explain what you're doing in plain language as you go. End with a short summary of what you decided or delivered (include PR/commit links if you created them).`;

  return runAgentPrompt(member, implementPrompt, {
    asMain: true,
    label: `${member.name} is carrying out the work…`,
    streamToChat: true,
  });
}

async function planAssignments(
  goal: string,
  team: TeamMember[],
  mode: RunMode
): Promise<BrainstormPlan> {
  const roster = team
    .filter((t) => t.id !== "orchestrator")
    .map((t) => `- ${t.id}: ${t.name} — ${t.role}`)
    .join("\n");

  const orch = team.find((t) => t.id === "orchestrator") ?? {
    id: "orchestrator",
    name: "Orchestrator",
    role: "Routes work",
  };

  emitStatus(orch.id, "working", "Figuring out who should do what…");
  bus.emitEvent({
    type: "orch",
    text:
      mode === "brainstorm"
        ? "Orchestrator is picking a lean brainstorm circle…"
        : "Orchestrator is planning the team lineup…",
    kind: "typing",
  });
  bus.emitEvent({
    type: "log",
    agentId: "orchestrator",
    kind: "instruct",
    text: goal,
  });

  const planPrompt =
    mode === "brainstorm"
      ? `${roleBrief(orch.id, orch.name, orch.role)}

Mode: BRAINSTORM (discussion only — no coding, no file edits, no commits).

Topic: ${goal}

Team roster (use these ids exactly when inviting existing teammates):
${roster}

Return ONLY JSON:
{
  "participants":[{"id":"bd","focus":"what they should discuss"}],
  "guests":[{"name":"Short name","role":"specialty","focus":"discussion angle"}]
}

Rules:
- Invite ONLY people needed for a useful brainstorm (usually 1–3 participants)
- Do NOT invite the whole team by default
- guests are optional temporary specialists missing from the roster (max 2)
- focus lines must be discussion prompts, not implementation tasks
- You do not implement anything`
      : `${roleBrief(orch.id, orch.name, orch.role)}

Goal: ${goal}

Team roster (use these ids exactly):
${roster}

Return ONLY JSON (no prose) in this shape:
{"assignments":[{"id":"manager","task":"..."},{"id":"bd","task":"..."}]}

Rules:
- Include ONLY teammates who are truly needed (not everyone by default)
- One clear task per id
- Tasks must match each role
- Do not implement the work yourself`;

  const planText = await runAgentPrompt(orch, planPrompt, {
    asMain: true,
    label: "Orchestrator is writing the plan…",
  });

  let plan: BrainstormPlan;
  if (mode === "brainstorm") {
    plan = extractBrainstormPlan(planText, team, goal);
  } else {
    const parsed = extractJson(planText);
    plan = {
      assignments: parsed?.length
        ? parsed
        : defaultAssignments(goal, team, mode),
      guests: [],
    };
  }

  const readable = plan.assignments
    .map((a) => {
      const m = team.find((t) => t.id === a.id);
      return `• ${m?.name || a.id}: ${a.task}`;
    })
    .join("\n");
  const guestLines = plan.guests
    .map((g) => `• Guest “${g.name}” (${g.role}): ${g.focus}`)
    .join("\n");

  bus.emitEvent({
    type: "orch",
    text:
      mode === "brainstorm"
        ? `Brainstorm circle:\n${[readable, guestLines].filter(Boolean).join("\n") || "• Orchestrator alone"}`
        : `Here’s who will do what:\n${readable}`,
    kind: "normal",
  });
  bus.emitEvent({
    type: "plan",
    goal: goal.trim(),
    assignments: plan.assignments,
  });
  emitStatus(
    orch.id,
    "working",
    mode === "brainstorm"
      ? "Opening the brainstorm…"
      : "Handing work to each teammate…"
  );
  return plan;
}

async function brainstormDiscuss(
  member: TeamMember,
  focus: string,
  goal: string
): Promise<string> {
  throwIfCancelled();
  const wsNote = workspaceHint(getActiveWorkspace());
  emitStatus(member.id, "working", `${member.name} is brainstorming…`);
  bus.emitEvent({
    type: "chat",
    agentId: member.id,
    role: "system",
    text: "Brainstorm mode — discussion only. No implementation.",
  });

  const prompt = `${roleBrief(member.id, member.name, member.role)}

${wsNote}

MODE: BRAINSTORM ONLY
- Discuss ideas, options, risks, open questions
- Do NOT write code, edit files, commit, or open PRs
- Keep it concrete and useful (a few sharp points)

Topic: ${goal}

Your angle:
${focus}

Reply in plain language with your brainstorm contribution.`;

  return runAgentPrompt(member, prompt, {
    asMain: true,
    label: `${member.name} is brainstorming…`,
    streamToChat: true,
  });
}

export async function runOrchestration(
  goal: string,
  team: TeamMember[],
  workspace: WorkspaceTarget | null = null,
  mode: RunMode = "build"
): Promise<void> {
  clearCancelFlag();
  clearSkipped();
  const trimmedGoal = goal.trim();
  const runMode = parseRunMode(mode);
  setActiveWorkspace(workspace);
  const job = startJob({
    goal: trimmedGoal,
    mode: runMode,
    workspaceUrl: workspace?.url ?? null,
  });
  bus.emitEvent({ type: "run", running: true });
  bus.emitEvent({
    type: "goal",
    goal: trimmedGoal,
    workspace: workspace
      ? { url: workspace.url, startingRef: workspace.startingRef }
      : null,
    mode: runMode,
  });
  if (runMode === "brainstorm") {
    bus.emitEvent({
      type: "orch",
      text: "Brainstorm mode — discussion only. Lean circle; guests may pop in and vanish.",
      kind: "normal",
    });
  }
  if (workspace?.url) {
    bus.emitEvent({
      type: "orch",
      text: `Working in repo: ${workspace.url}${
        workspace.startingRef ? ` @ ${workspace.startingRef}` : ""
      }`,
      kind: "normal",
    });
  }
  const reports: { id: string; name: string; report: string }[] = [];
  let jobOutcome: "done" | "cancelled" | "error" = "done";
  let jobSummary = "";

  try {
    const roster =
      team.length > 0
        ? team
        : BUILTIN_ROLES.map((r) => ({
            id: r.id,
            name: r.name,
            role: r.role,
          }));

    const plan = await planAssignments(trimmedGoal, roster, runMode);
    const byId = new Map(roster.map((t) => [t.id, t]));

    for (const job of plan.assignments) {
      throwIfCancelled();
      const member = byId.get(job.id);
      if (!member || member.id === "orchestrator") continue;

      if (isSkipped(member.id)) {
        emitSkipped(member, job.task);
        continue;
      }

      bus.emitEvent({
        type: "task",
        agentId: member.id,
        phase: "active",
        task: job.task,
      });
      bus.emitEvent({
        type: "log",
        agentId: member.id,
        kind: "instruct",
        text: job.task,
      });
      bus.emitEvent({
        type: "chat",
        agentId: member.id,
        role: "user",
        text: job.task,
      });
      bus.emitEvent({
        type: "orch",
        text:
          runMode === "brainstorm"
            ? `${member.name} joins the brainstorm.`
            : `${member.name} is up next.`,
        kind: "normal",
      });

      try {
        const report =
          runMode === "brainstorm"
            ? await brainstormDiscuss(member, job.task, trimmedGoal)
            : await askThenImplement(member, job.task, trimmedGoal);
        if (isSkipped(member.id)) {
          emitSkipped(member, job.task);
          continue;
        }
        reports.push({ id: member.id, name: member.name, report });
        emitStatus(
          member.id,
          "done",
          runMode === "brainstorm"
            ? "Shared their ideas."
            : "Finished their part."
        );
        bus.emitEvent({
          type: "task",
          agentId: member.id,
          phase: "done",
          task: job.task,
        });
        bus.emitEvent({
          type: "orch",
          text:
            runMode === "brainstorm"
              ? `${member.name} shared their take.`
              : `${member.name} finished.`,
          kind: "normal",
        });
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        if (err instanceof SkippedError || isSkipped(member.id)) {
          emitSkipped(member, job.task);
          continue;
        }
        const msg = explainCursorError(err);
        bus.emitEvent({
          type: "chat",
          agentId: member.id,
          role: "agent",
          text: msg,
        });
        emitStatus(member.id, "blocked", msg);
        bus.emitEvent({ type: "error", message: `${member.name}: ${msg}` });
      }
    }

    // Brainstorm guests — ephemeral bubbles that smoke-vanish when done
    if (runMode === "brainstorm" && plan.guests.length) {
      throwIfCancelled();
      const orchForGuests = byId.get("orchestrator") ?? {
        id: "orchestrator",
        name: "Orchestrator",
        role: "Routes work",
      };
      bus.emitEvent({
        type: "orch",
        text: `Orchestrator is bringing in ${plan.guests.length} guest specialist${plan.guests.length > 1 ? "s" : ""}…`,
        kind: "normal",
      });
      const guestReports = await runRequestedSubagents(
        orchForGuests,
        plan.guests.map((g) => ({
          name: g.name,
          role: g.role,
          task: `BRAINSTORM ONLY (no code, no edits). Topic: ${trimmedGoal}\n\nYour angle: ${g.focus}`,
        }))
      );
      for (const g of guestReports) {
        reports.push({
          id: `guest-${g.name}`,
          name: g.name,
          report: g.report,
        });
        bus.emitEvent({
          type: "orch",
          text: `Guest “${g.name}”: ${g.report.slice(0, 400)}`,
          kind: "normal",
        });
      }
    }

    throwIfCancelled();

    const orch = byId.get("orchestrator") ?? {
      id: "orchestrator",
      name: "Orchestrator",
      role: "Routes work",
    };
    emitStatus(
      orch.id,
      "working",
      runMode === "brainstorm"
        ? "Synthesizing the brainstorm…"
        : "Writing a tiny wrap-up…"
    );
    bus.emitEvent({
      type: "orch",
      text:
        runMode === "brainstorm"
          ? "Orchestrator is synthesizing the brainstorm…"
          : "Orchestrator is writing a brief final summary…",
      kind: "typing",
    });

    const digest = reports
      .map((r) => `### ${r.name}\n${r.report.slice(0, 400)}`)
      .join("\n\n");

    const summaryRaw = await runAgentPrompt(
      orch,
      runMode === "brainstorm"
        ? `You are the Orchestrator wrapping a BRAINSTORM (discussion only — nothing was built).

Topic: ${trimmedGoal}

Ideas from the circle:
${digest || "(none)"}

Reply with a VERY brief synthesis:
- Exactly 1–2 short sentences
- Name the strongest direction or open question
- Plain language, no bullets, no “next steps” list`
        : `You are the Orchestrator. All teammates finished.

Goal: ${goal}

Teammate notes:
${digest || "(none)"}

Reply with a VERY brief final summary for the user:
- Exactly 1–2 short sentences
- Plain language
- No bullets, no headings, no next-steps list
- Celebrate completion lightly`,
      {
        asMain: true,
        label:
          runMode === "brainstorm"
            ? "Orchestrator is synthesizing…"
            : "Orchestrator is wrapping up…",
        streamToChat: false,
      }
    );

    const summary = summaryRaw
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280);

    bus.emitEvent({ type: "orch", text: summary, kind: "summary" });
    emitStatus(orch.id, "done", "All tasks complete.");
    bus.emitEvent({ type: "success", summary });
    bus.emitEvent({ type: "done" });
    jobSummary = summary;
    jobOutcome = "done";
  } catch (err) {
    if (err instanceof CancelledError) {
      jobOutcome = "cancelled";
      jobSummary = "Stopped by you.";
      bus.emitEvent({
        type: "cancelled",
        message: "Stopped. Current agent work was cancelled.",
      });
      bus.emitEvent({
        type: "orch",
        text: "Stopped. Current agent work was cancelled.",
        kind: "normal",
      });
      emitStatus("orchestrator", "idle", "Stopped by you.");
      return;
    }
    jobOutcome = "error";
    const msg = explainCursorError(err);
    jobSummary = msg;
    bus.emitEvent({ type: "error", message: msg });
    bus.emitEvent({ type: "orch", text: msg, kind: "normal" });
    emitStatus("orchestrator", "blocked", msg);
  } finally {
    finishJob(job.id, jobOutcome, jobSummary);
    bus.emitEvent({ type: "run", running: false });
    setActiveWorkspace(null);
  }
}

export async function instructOne(
  member: TeamMember,
  instruction: string,
  team: TeamMember[] = [],
  workspace: WorkspaceTarget | null = null
): Promise<void> {
  if (member.id === "orchestrator") {
    const roster =
      team.length > 0
        ? team
        : BUILTIN_ROLES.map((r) => ({
            id: r.id,
            name: r.name,
            role: r.role,
          }));
    await runOrchestration(instruction, roster, workspace);
    return;
  }

  clearCancelFlag();
  setActiveWorkspace(workspace);
  const job = startJob({
    goal: instruction.trim(),
    mode: "build",
    workspaceUrl: workspace?.url ?? null,
  });
  bus.emitEvent({ type: "run", running: true });
  bus.emitEvent({
    type: "goal",
    goal: instruction,
    workspace: workspace
      ? { url: workspace.url, startingRef: workspace.startingRef }
      : null,
  });
  bus.emitEvent({
    type: "plan",
    goal: instruction,
    assignments: [{ id: member.id, task: instruction }],
  });
  let jobOutcome: "done" | "cancelled" | "error" = "done";
  let jobSummary = "";
  try {
    bus.emitEvent({
      type: "task",
      agentId: member.id,
      phase: "active",
      task: instruction,
    });
    bus.emitEvent({
      type: "log",
      agentId: member.id,
      kind: "instruct",
      text: instruction,
    });

    const report = await askThenImplement(member, instruction, instruction);
    emitStatus(member.id, "done", "Finished.");
    bus.emitEvent({
      type: "task",
      agentId: member.id,
      phase: "done",
      task: instruction,
    });
    bus.emitEvent({
      type: "orch",
      text: `${member.name} reported back:\n\n${report}`,
      kind: "summary",
    });
    bus.emitEvent({ type: "done" });
    jobSummary = report.replace(/\n+/g, " ").trim().slice(0, 280);
    jobOutcome = "done";
  } catch (err) {
    if (err instanceof CancelledError) {
      jobOutcome = "cancelled";
      jobSummary = "Stopped by you.";
      bus.emitEvent({
        type: "cancelled",
        message: `${member.name} stopped.`,
      });
      bus.emitEvent({
        type: "chat",
        agentId: member.id,
        role: "system",
        text: "Stopped by you.",
      });
      emitStatus(member.id, "idle", "Stopped by you.");
      return;
    }
    jobOutcome = "error";
    const msg = explainCursorError(err);
    jobSummary = msg;
    bus.emitEvent({ type: "error", message: msg });
    emitStatus(member.id, "blocked", msg);
  } finally {
    finishJob(job.id, jobOutcome, jobSummary);
    bus.emitEvent({ type: "run", running: false });
    setActiveWorkspace(null);
  }
}

export async function spawnSideQuery(
  member: TeamMember,
  instruction: string
): Promise<void> {
  try {
    await runSubagentQuery(member, instruction);
  } catch (err) {
    bus.emitEvent({
      type: "error",
      message: explainCursorError(err),
    });
    bus.emitEvent({
      type: "chat",
      agentId: member.id,
      role: "system",
      text: `Side helper failed: ${explainCursorError(err)}`,
    });
  }
}

export function tryProvideAnswers(agentId: string, text: string) {
  return provideAnswers(agentId, text);
}

export function agentIsMainBusy(agentId: string) {
  return isMainBusy(agentId);
}
