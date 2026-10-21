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
  throwIfCancelled,
} from "./pool";
import { parseSubagentRequest } from "./subagents";

export type TeamMember = {
  id: string;
  name: string;
  role: string;
};

type Assignment = { id: string; task: string };

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

function defaultAssignments(goal: string, team: TeamMember[]): Assignment[] {
  return team
    .filter((t) => t.id !== "orchestrator")
    .map((t) => ({
      id: t.id,
      task: `For the goal “${goal}”, do your job as ${t.name} (${t.role}).`,
    }));
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

  const askPrompt = `${roleBrief(member.id, member.name, member.role)}

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

Overall goal: ${goal}

Your assignment:
${task}

User answers / guidance:
${answers}

Notes from temporary helpers (if any):
${helperDigest}

Now implement / complete the assignment yourself. Use helper notes where useful. Explain what you're doing in plain language as you go. End with a short summary of what you decided or delivered.`;

  return runAgentPrompt(member, implementPrompt, {
    asMain: true,
    label: `${member.name} is carrying out the work…`,
    streamToChat: true,
  });
}

async function planAssignments(
  goal: string,
  team: TeamMember[]
): Promise<Assignment[]> {
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
    text: "Orchestrator is planning the team lineup…",
    kind: "typing",
  });
  bus.emitEvent({
    type: "log",
    agentId: "orchestrator",
    kind: "instruct",
    text: goal,
  });

  const planPrompt = `${roleBrief(orch.id, orch.name, orch.role)}

Goal: ${goal}

Team roster (use these ids exactly):
${roster}

Return ONLY JSON (no prose) in this shape:
{"assignments":[{"id":"manager","task":"..."},{"id":"bd","task":"..."}]}

Rules:
- Include every teammate that should work this goal
- One clear task per id
- Tasks must match each role
- Do not implement the work yourself`;

  const planText = await runAgentPrompt(orch, planPrompt, {
    asMain: true,
    label: "Orchestrator is writing the plan…",
  });

  const parsed = extractJson(planText);
  const assignments = parsed?.length ? parsed : defaultAssignments(goal, team);

  const readable = assignments
    .map((a) => {
      const m = team.find((t) => t.id === a.id);
      return `• ${m?.name || a.id}: ${a.task}`;
    })
    .join("\n");

  bus.emitEvent({
    type: "orch",
    text: `Here’s who will do what:\n${readable}`,
    kind: "normal",
  });
  bus.emitEvent({
    type: "plan",
    goal: goal.trim(),
    assignments,
  });
  emitStatus(orch.id, "working", "Handing work to each teammate…");
  return assignments;
}

export async function runOrchestration(
  goal: string,
  team: TeamMember[]
): Promise<void> {
  clearCancelFlag();
  const trimmedGoal = goal.trim();
  bus.emitEvent({ type: "run", running: true });
  bus.emitEvent({ type: "goal", goal: trimmedGoal });
  const reports: { id: string; name: string; report: string }[] = [];

  try {
    const roster =
      team.length > 0
        ? team
        : BUILTIN_ROLES.map((r) => ({
            id: r.id,
            name: r.name,
            role: r.role,
          }));

    const assignments = await planAssignments(trimmedGoal, roster);
    const byId = new Map(roster.map((t) => [t.id, t]));

    for (const job of assignments) {
      throwIfCancelled();
      const member = byId.get(job.id);
      if (!member || member.id === "orchestrator") continue;

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
        text: `${member.name} is up next.`,
        kind: "normal",
      });

      try {
        const report = await askThenImplement(member, job.task, trimmedGoal);
        reports.push({ id: member.id, name: member.name, report });
        emitStatus(member.id, "done", "Finished their part.");
        bus.emitEvent({
          type: "task",
          agentId: member.id,
          phase: "done",
          task: job.task,
        });
        bus.emitEvent({
          type: "orch",
          text: `${member.name} finished.`,
          kind: "normal",
        });
      } catch (err) {
        if (err instanceof CancelledError) throw err;
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

    throwIfCancelled();

    const orch = byId.get("orchestrator") ?? {
      id: "orchestrator",
      name: "Orchestrator",
      role: "Routes work",
    };
    emitStatus(orch.id, "working", "Writing a tiny wrap-up…");
    bus.emitEvent({
      type: "orch",
      text: "Orchestrator is writing a brief final summary…",
      kind: "typing",
    });

    const digest = reports
      .map((r) => `### ${r.name}\n${r.report.slice(0, 400)}`)
      .join("\n\n");

    const summaryRaw = await runAgentPrompt(
      orch,
      `You are the Orchestrator. All teammates finished.

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
        label: "Orchestrator is wrapping up…",
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
  } catch (err) {
    if (err instanceof CancelledError) {
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
    const msg = explainCursorError(err);
    bus.emitEvent({ type: "error", message: msg });
    bus.emitEvent({ type: "orch", text: msg, kind: "normal" });
    emitStatus("orchestrator", "blocked", msg);
  } finally {
    bus.emitEvent({ type: "run", running: false });
  }
}

export async function instructOne(
  member: TeamMember,
  instruction: string,
  team: TeamMember[] = []
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
    await runOrchestration(instruction, roster);
    return;
  }

  clearCancelFlag();
  bus.emitEvent({ type: "run", running: true });
  bus.emitEvent({ type: "goal", goal: instruction });
  bus.emitEvent({
    type: "plan",
    goal: instruction,
    assignments: [{ id: member.id, task: instruction }],
  });
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
  } catch (err) {
    if (err instanceof CancelledError) {
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
    const msg = explainCursorError(err);
    bus.emitEvent({ type: "error", message: msg });
    emitStatus(member.id, "blocked", msg);
  } finally {
    bus.emitEvent({ type: "run", running: false });
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
