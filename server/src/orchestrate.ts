import { provideAnswers, waitForAnswers } from "./awaiting";
import { bus } from "./bus";
import { parseStructuredQuestions } from "./questions";
import {
  canWriteCode,
  codeRulesForAgent,
  implementClosingLine,
  readOnlyCodeRules,
} from "./codeAccess";
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
import {
  isDiscussMode,
  isFastMode,
  parseRunMode,
  type RunMode,
} from "./runMode";
import { clearSkipped, isSkipped } from "./skip";
import {
  artifactsPromptHint,
  harvestArtifactsFromText,
  registerFinalResponseArtifact,
} from "./artifacts";
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

/** Heuristic: small fix vs feature; whether PR/merge and design/BD are needed. */
export type BuildScope = {
  kind: "small_fix" | "feature";
  needsPr: boolean;
  needsDesign: boolean;
  needsBd: boolean;
};

export function classifyBuildScope(
  goal: string,
  workspace: WorkspaceTarget | null = getActiveWorkspace()
): BuildScope {
  const g = goal.toLowerCase();

  const needsPr =
    Boolean(workspace?.url) ||
    /\b(pr|pull request|merge(?:s|d)? to main|open a pr|create a pr)\b/i.test(
      goal
    );

  const needsDesign =
    /\b(ui|ux|design|layout|landing|visual|brand(?:ing)?|color|font|stylesheet|css|figma|look and feel|wireframe)\b/i.test(
      g
    );

  const needsBd =
    /\b(pricing|gtm|go.to.market|positioning|persona|icp|who (?:it'?s|is) for|marketing|sales|pitch|hook|offer|customer)\b/i.test(
      g
    );

  const smallFix =
    /\b(fix|bug|hotfix|typo|patch|regression|broken|crash|error|nit|chore|bump|deps?|dependency|rename|typo)\b/i.test(
      g
    ) ||
    (/\b(small|quick|tiny|minor)\b/i.test(g) &&
      /\b(fix|change|update|tweak)\b/i.test(g));

  // Default to feature when not clearly a small fix
  const kind: BuildScope["kind"] = smallFix ? "small_fix" : "feature";

  return { kind, needsPr, needsDesign, needsBd };
}

function buildPipelineIds(scope: BuildScope): string[] {
  if (scope.kind === "small_fix") {
    // Orchestrator → Dev → (Merger only if PR)
    const ids = ["dev"];
    if (scope.needsPr) ids.push("merger");
    return ids;
  }
  // Feature: Researcher → Dev → QA → Merger (+ Designer/BD only when needed)
  const ids = ["researcher", "dev", "qa", "merger"];
  if (scope.needsDesign) ids.splice(1, 0, "designer"); // after researcher
  if (scope.needsBd) {
    const at = ids.indexOf("designer") >= 0 ? ids.indexOf("designer") : 1;
    ids.splice(at, 0, "bd");
  }
  return ids;
}

function taskForRole(
  id: string,
  goal: string,
  mode: RunMode,
  scope: BuildScope
): string {
  if (isDiscussMode(mode)) {
    return `Casual chat only (no implementation, no clarifying questions) for “${goal}”. Assume sensible defaults and reply conversationally.`;
  }
  switch (id) {
    case "researcher":
      return `Feature research for “${goal}”: facts, constraints, and risks Dev needs before building. Keep it short.`;
    case "bd":
      return `For “${goal}”: who it’s for, the offer, and one clear hook. Skip fluff.`;
    case "designer":
      return `For “${goal}”: concrete UI direction and any UI code changes needed (styles, components, layout). Dev handles non-UI code.`;
    case "dev":
      return scope.kind === "small_fix"
        ? `Small fix for “${goal}”: make the minimal correct change, add or update unit tests for it${scope.needsPr ? ", open/update a PR" : ""}, summarize what changed.`
        : `Build the feature for “${goal}”: smallest working slice, add or update unit tests${scope.needsPr ? ", open a PR" : ""}, summarize what you shipped.`;
    case "qa":
      return `Pre-merge QA for “${goal}”: read-only PR/diff review + run unit tests. NEVER edit code. If issues: QA_VERDICT: REQUEST_CHANGES with a concrete Dev fix list. If clean: QA_VERDICT: APPROVE. No live/E2E unless a preview URL is given.`;
    case "merger":
      return `Merge only after QA approved (diff review + unit tests). Review the PR for “${goal}”. If solid, merge to main. If not, list required changes — do not merge.`;
    default:
      return `For the goal “${goal}”, do your job.`;
  }
}

function fastDevTask(goal: string): string {
  return `FAST MODE — you are the only builder. Do this end-to-end for “${goal}”:
1. Make the code changes (smallest correct fix) and add or update unit tests.
2. Commit with a clear message.
3. Open or update a pull request.
4. Merge the PR into main (use gh/git; no force-push; don’t skip hooks unless told).
5. Reply in plain English with what changed and the PR/merge links.

Skip clarifying questions. Assume sensible defaults. Do not wait for other agents.`;
}

function defaultAssignments(
  goal: string,
  team: TeamMember[],
  mode: RunMode,
  workspace: WorkspaceTarget | null = getActiveWorkspace()
): Assignment[] {
  const pool = team.filter((t) => t.id !== "orchestrator");
  const byId = new Map(pool.map((t) => [t.id, t]));

  if (isFastMode(mode)) {
    const dev = byId.get("dev") ?? pool[0];
    if (!dev) return [];
    return [{ id: dev.id, task: fastDevTask(goal) }];
  }

  if (isDiscussMode(mode)) {
    const leanIds = ["researcher", "bd"].filter((id) => byId.has(id));
    const ids = leanIds.length
      ? leanIds.slice(0, 3)
      : pool.slice(0, 2).map((t) => t.id);
    return ids
      .map((id) => byId.get(id))
      .filter((t): t is TeamMember => Boolean(t))
      .map((t) => ({
        id: t.id,
        task: taskForRole(t.id, goal, mode, classifyBuildScope(goal, workspace)),
      }));
  }

  const scope = classifyBuildScope(goal, workspace);
  const pipeline = buildPipelineIds(scope).filter((id) => byId.has(id));
  // Fallback if roster is missing roles
  const ids = pipeline.length
    ? pipeline
    : ["dev"].filter((id) => byId.has(id));
  return ids.map((id) => ({
    id,
    task: taskForRole(id, goal, mode, scope),
  }));
}

/** Drop Designer/BD unless scope needs them; keep pipeline order; merger only if PR. */
function sanitizeBuildAssignments(
  assignments: Assignment[],
  team: TeamMember[],
  goal: string,
  workspace: WorkspaceTarget | null
): Assignment[] {
  const scope = classifyBuildScope(goal, workspace);
  const allowed = new Set(buildPipelineIds(scope));
  // Strip Designer/BD unless the goal needs them; Merger only on small_fix when PR
  if (!scope.needsDesign) allowed.delete("designer");
  if (!scope.needsBd) allowed.delete("bd");
  if (scope.kind === "small_fix" && !scope.needsPr) allowed.delete("merger");

  const teamIds = new Set(team.map((t) => t.id));
  const seen = new Set<string>();
  const out: Assignment[] = [];
  for (const a of assignments) {
    if (!teamIds.has(a.id) || a.id === "orchestrator") continue;
    if (!allowed.has(a.id)) continue;
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  // Ensure required pipeline roles exist even if the LLM omitted them
  for (const id of buildPipelineIds(scope)) {
    if (!teamIds.has(id) || seen.has(id)) continue;
    if (!allowed.has(id)) continue;
    out.push({ id, task: taskForRole(id, goal, "build", scope) });
    seen.add(id);
  }
  // Preserve preferred order
  const order = buildPipelineIds(scope);
  out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return out.length ? out : defaultAssignments(goal, team, "build", workspace);
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
          assignments: assignments.slice(0, 6),
          guests,
        };
      }
    } catch {
      /* fall through */
    }
  }
  return {
    assignments: defaultAssignments(goal, team, "casual"),
    guests: [],
  };
}

function extractDiscussPlan(
  text: string,
  team: TeamMember[],
  goal: string,
  mode: RunMode
): BrainstormPlan {
  const plan = extractBrainstormPlan(text, team, goal);
  if (plan.assignments.length || plan.guests.length) return plan;
  return {
    assignments: defaultAssignments(goal, team, mode),
    guests: [],
  };
}

const QA_MAX_ROUNDS = 3;

function parseQaVerdict(report: string): "approve" | "request_changes" | "unknown" {
  const m = report.match(/QA_VERDICT:\s*(APPROVE|REQUEST_CHANGES)/i);
  if (!m) {
    // Soft fallbacks if the model forgets the marker
    if (/\bapprove for merge\b/i.test(report) && !/\brequest changes\b/i.test(report)) {
      return "approve";
    }
    if (/\brequest changes\b/i.test(report) || /\bQA_VERDICT:\s*REQUEST/i.test(report)) {
      return "request_changes";
    }
    return "unknown";
  }
  return m[1].toUpperCase() === "APPROVE" ? "approve" : "request_changes";
}

function markAgentActive(member: TeamMember, task: string) {
  bus.emitEvent({
    type: "task",
    agentId: member.id,
    phase: "active",
    task,
  });
  bus.emitEvent({
    type: "log",
    agentId: member.id,
    kind: "instruct",
    text: task,
  });
}

function markAgentDone(member: TeamMember, task: string, note: string) {
  emitStatus(member.id, "done", note);
  bus.emitEvent({
    type: "task",
    agentId: member.id,
    phase: "done",
    task,
  });
}

/**
 * QA is read-only. On REQUEST_CHANGES → Dev patches → QA again until APPROVE
 * (or max rounds). QA stage completes only on APPROVE.
 */
async function runQaWithDevLoop(opts: {
  qa: TeamMember;
  dev: TeamMember | undefined;
  qaTask: string;
  goal: string;
  priorDevReport?: string;
}): Promise<{ qaReport: string; extraReports: { id: string; name: string; report: string }[] }> {
  const { qa, dev, qaTask, goal } = opts;
  const extraReports: { id: string; name: string; report: string }[] = [];
  let context = opts.priorDevReport
    ? `\n\nLatest Dev summary:\n${opts.priorDevReport.slice(0, 4000)}`
    : "";

  for (let round = 1; round <= QA_MAX_ROUNDS; round++) {
    throwIfCancelled();
    if (isSkipped(qa.id)) throw new SkippedError(qa.id);

    const roundTask =
      round === 1
        ? `${qaTask}${context}`
        : `Re-check after Dev’s patch (round ${round}/${QA_MAX_ROUNDS}).${context}

${qaTask}

Remember: read-only. End with QA_VERDICT: APPROVE or QA_VERDICT: REQUEST_CHANGES.`;

    markAgentActive(qa, roundTask);
    bus.emitEvent({
      type: "orch",
      text:
        round === 1
          ? `${qa.name} is reviewing the diff and running unit tests…`
          : `${qa.name} is re-checking after Dev’s fixes (round ${round})…`,
      kind: "normal",
    });
    bus.emitEvent({
      type: "chat",
      agentId: qa.id,
      role: "user",
      text: roundTask,
    });

    const qaReport = await askThenImplement(qa, roundTask, goal);
    if (isSkipped(qa.id)) throw new SkippedError(qa.id);

    const verdict = parseQaVerdict(qaReport);
    bus.emitEvent({
      type: "chat",
      agentId: qa.id,
      role: "system",
      text:
        verdict === "approve"
          ? "QA approved — stage complete."
          : verdict === "request_changes"
            ? "QA requested changes — sending back to Dev."
            : "QA did not emit a clear verdict — treating as request changes.",
    });

    if (verdict === "approve") {
      markAgentDone(qa, qaTask, "QA approved — review + unit tests passed.");
      return { qaReport, extraReports };
    }

    // Needs Dev — or stop if no Dev / last round
    if (!dev || isSkipped(dev.id)) {
      markAgentDone(
        qa,
        qaTask,
        "QA still has issues but Dev is unavailable — stage ended with open findings."
      );
      bus.emitEvent({
        type: "orch",
        text: `${qa.name} needs Dev fixes, but Dev isn’t available. Continuing.`,
        kind: "normal",
      });
      return { qaReport, extraReports };
    }

    if (round >= QA_MAX_ROUNDS) {
      markAgentDone(
        qa,
        qaTask,
        "Max QA↔Dev rounds reached — open findings remain."
      );
      bus.emitEvent({
        type: "orch",
        text: `${qa.name} and ${dev.name} hit the round limit. Merger should treat as not fully approved.`,
        kind: "normal",
      });
      return { qaReport, extraReports };
    }

    // Hand back to Dev (QA not done yet)
    emitStatus(qa.id, "idle", "Waiting on Dev to patch QA findings.");
    bus.emitEvent({
      type: "task",
      agentId: qa.id,
      phase: "active",
      task: "Waiting on Dev fixes…",
    });
    bus.emitEvent({
      type: "orch",
      text: `${qa.name} → ${dev.name}: please implement the QA fix list, then hand back.`,
      kind: "normal",
    });

    const patchTask = `QA sent your work back. Implement ONLY these fixes, update the PR/commits, then stop so QA can re-check.

Goal: ${goal}

QA report (fix list):
${qaReport.slice(0, 6000)}

Do not do unrelated refactors. Summarize what you changed.`;

    markAgentActive(dev, patchTask);
    bus.emitEvent({
      type: "chat",
      agentId: dev.id,
      role: "user",
      text: patchTask,
    });
    bus.emitEvent({
      type: "chat",
      agentId: qa.id,
      role: "system",
      text: `Sent findings to ${dev.name}. Waiting for their patch.`,
    });

    const devReport = await askThenImplement(dev, patchTask, goal);
    if (isSkipped(dev.id)) throw new SkippedError(dev.id);

    extraReports.push({ id: dev.id, name: dev.name, report: devReport });
    markAgentDone(dev, patchTask, "Patch for QA handed back.");
    bus.emitEvent({
      type: "orch",
      text: `${dev.name} finished the patch — back to ${qa.name}.`,
      kind: "normal",
    });
    bus.emitEvent({
      type: "chat",
      agentId: qa.id,
      role: "system",
      text: `${dev.name} handed work back for re-check.`,
    });

    context = `\n\nDev patch summary (round ${round}):\n${devReport.slice(0, 4000)}`;
  }

  return { qaReport: "QA loop ended without approval.", extraReports };
}

async function askThenImplement(
  member: TeamMember,
  task: string,
  goal: string,
  opts: { fast?: boolean } = {}
): Promise<string> {
  throwIfCancelled();
  const fast = !!opts.fast;
  const wsNote = workspaceHint(getActiveWorkspace());

  // Fast mode: Dev jumps straight to implement → commit → merge (no ask/helpers)
  if (fast) {
    emitStatus(member.id, "working", `${member.name} is shipping fast…`);
    bus.emitEvent({
      type: "chat",
      agentId: member.id,
      role: "system",
      text: "Fast mode — skipping questions and helpers. Build, commit, merge.",
    });
    const implementPrompt = `${roleBrief(member.id, member.name, member.role)}

${wsNote}

Overall goal: ${goal}

Your assignment:
${task}

${codeRulesForAgent(member.id, member.name)}

FAST RULES:
- No clarifying questions — assume defaults.
- No helpers.
- Implement, commit, open/update PR, merge to main.
- Plain English summary + links when done.`;

    return runAgentPrompt(member, implementPrompt, {
      asMain: true,
      label: `${member.name} is shipping (fast)…`,
      streamToChat: true,
    });
  }

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
    } catch (err) {
      if (err instanceof SkippedError || isSkipped(member.id)) {
        throw err instanceof SkippedError
          ? err
          : new SkippedError(member.id);
      }
      throw err;
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

  // QA is read-only: no helpers, no code edits — review + unit tests only
  if (member.id === "qa" || !canWriteCode(member.id)) {
    const readOnly = member.id === "qa";
    emitStatus(
      member.id,
      "working",
      readOnly
        ? `${member.name} is reviewing (read-only)…`
        : `${member.name} is working (no code changes)…`
    );
    const qaExtra = readOnly
      ? `
- Do NOT “fix it yourself.” Send fixes to Dev via QA_VERDICT: REQUEST_CHANGES.
- Run existing unit tests.
- End with exactly one machine line: QA_VERDICT: APPROVE  or  QA_VERDICT: REQUEST_CHANGES`
      : "";
    const reviewPrompt = `${roleBrief(member.id, member.name, member.role)}

${wsNote}

Overall goal: ${goal}

Your assignment:
${task}

User answers / guidance:
${answers}

${readOnlyCodeRules(member.name)}
${qaExtra}
- Chat in plain English: no exception names, HTTP codes, file paths, or test-file dumps. Say what a teammate needs to know.

${implementClosingLine(member.id)}`;

    return runAgentPrompt(member, reviewPrompt, {
      asMain: true,
      label: readOnly
        ? `${member.name} is reviewing the diff / running tests…`
        : `${member.name} is completing the assignment…`,
      streamToChat: true,
    });
  }

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
- Helpers must NOT edit application source code unless you are Dev or UI Designer
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

${codeRulesForAgent(member.id, member.name)}

${implementClosingLine(member.id)}`;

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
  const workspace = getActiveWorkspace();
  const scope = classifyBuildScope(goal, workspace);
  const roster = team
    .filter((t) => t.id !== "orchestrator")
    .map((t) => `- ${t.id}: ${t.name} — ${t.role}`)
    .join("\n");

  const orch = team.find((t) => t.id === "orchestrator") ?? {
    id: "orchestrator",
    name: "Orchestrator",
    role: "Routes work",
  };

  // Fast mode: no planner LLM — hand straight to Dev
  if (isFastMode(mode)) {
    const assignments = defaultAssignments(goal, team, mode, workspace);
    emitStatus(orch.id, "working", "Fast mode — sending Dev alone…");
    bus.emitEvent({
      type: "orch",
      text: "Fast mode — Orchestrator skips the crew. Dev ships, commits, and merges.",
      kind: "typing",
    });
    bus.emitEvent({
      type: "log",
      agentId: "orchestrator",
      kind: "instruct",
      text: goal,
    });
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
    emitStatus(orch.id, "working", "Handing off to Dev…");
    return { assignments, guests: [] };
  }

  emitStatus(orch.id, "working", "Figuring out who should do what…");
  bus.emitEvent({
    type: "orch",
    text:
      mode === "casual"
        ? "Orchestrator is opening a casual chat circle…"
        : scope.kind === "small_fix"
          ? `Small fix — lean lineup (Dev${scope.needsPr ? " → Merger" : ""})…`
          : "Feature — Researcher → Dev → QA → Merger…",
    kind: "typing",
  });
  bus.emitEvent({
    type: "log",
    agentId: "orchestrator",
    kind: "instruct",
    text: goal,
  });

  const suggestedIds = buildPipelineIds(scope)
    .filter((id) => team.some((t) => t.id === id))
    .join(", ");

  const planPrompt = isDiscussMode(mode)
    ? `${roleBrief(orch.id, orch.name, orch.role)}

Mode: CASUAL CONVERSATION (discussion only — no coding, no file edits, no commits).
Agents must NOT ask clarifying questions — assume sensible defaults and reply like a chat.

Topic: ${goal}

Team roster (use these ids exactly when inviting existing teammates):
${roster}

Return ONLY JSON:
{
  "participants":[{"id":"bd","focus":"what they should discuss"}],
  "guests":[{"name":"Short name","role":"specialty","focus":"discussion angle"}]
}

Rules:
- Invite ONLY people needed (usually 1–3 participants)
- Do NOT invite the whole team by default
- guests are optional temporary specialists missing from the roster (max 2)
- focus lines must be discussion prompts, not implementation tasks
- You do not implement anything`
    : `${roleBrief(orch.id, orch.name, orch.role)}

Goal: ${goal}

Workspace: ${
      workspace?.url
        ? `${workspace.url} (PR/merge expected)`
        : "local / no GitHub repo (no merger unless goal explicitly asks for a PR)"
    }
Classified as: ${scope.kind === "small_fix" ? "SMALL FIX" : "FEATURE"}
Suggested ids (prefer this order): ${suggestedIds || "dev"}

Team roster (use these ids exactly):
${roster}

Return ONLY JSON (no prose) in this shape:
{"assignments":[{"id":"dev","task":"..."}]}

Hard rules for lineup:
1. SMALL FIX → only "dev", then "merger" last ONLY if a PR/repo/merge is in play. Do NOT include researcher, qa, designer, or bd.
2. FEATURE → "researcher" → "dev" → "qa" → "merger" (in that order). QA = diff review + unit tests (not live E2E).
3. Include "designer" ONLY if the goal is clearly about UI/visual/brand/layout.
4. Include "bd" ONLY if the goal is clearly about who-it’s-for / offer / GTM / marketing.
5. Never assign the whole roster by default. One clear task per id. Do not implement the work yourself.`;

  const planText = await runAgentPrompt(orch, planPrompt, {
    asMain: true,
    label: "Orchestrator is writing the plan…",
  });

  let plan: BrainstormPlan;
  if (isDiscussMode(mode)) {
    plan = extractDiscussPlan(planText, team, goal, mode);
  } else {
    const parsed = extractJson(planText);
    const raw = parsed?.length
      ? parsed
      : defaultAssignments(goal, team, mode, workspace);
    plan = {
      assignments: sanitizeBuildAssignments(raw, team, goal, workspace),
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
    text: isDiscussMode(mode)
      ? `Casual circle:\n${[readable, guestLines].filter(Boolean).join("\n") || "• Orchestrator alone"}`
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
    mode === "casual"
      ? "Opening the casual chat…"
      : "Handing work to each teammate…"
  );
  return plan;
}

async function casualDiscuss(
  member: TeamMember,
  focus: string,
  goal: string,
  opts: { jobId?: string } = {}
): Promise<string> {
  throwIfCancelled();
  const wsNote = workspaceHint(getActiveWorkspace());
  emitStatus(member.id, "working", `${member.name} is chatting…`);
  bus.emitEvent({
    type: "chat",
    agentId: member.id,
    role: "system",
    text: "Casual mode — chat or drop an artifact. No clarifying questions.",
  });

  const prompt = `${roleBrief(member.id, member.name, member.role)}

${wsNote}

MODE: CASUAL CONVERSATION
- Reply like a teammate in a chat — natural, direct, warm
- Do NOT ask clarifying questions — assume sensible defaults when unsure
- Do NOT edit the project codebase, commit, or open PRs
- Keep the spoken reply short
- If the topic asks for a finished file (HTML, CSS, etc.), put ONLY that final product in an artifact fence
- Plans, briefs, research notes, and checklists stay in chat — never as artifacts

${artifactsPromptHint()}

Topic: ${goal}

Your angle:
${focus}

Respond now.`;

  const raw = await runAgentPrompt(member, prompt, {
    asMain: true,
    label: `${member.name} is chatting…`,
    // Harvest fences before chat so download blocks aren't shown raw
    streamToChat: false,
  });

  let artifacts: { name: string }[] = [];
  let reply = raw;
  if (opts.jobId) {
    const harvested = harvestArtifactsFromText(opts.jobId, raw, member.id);
    reply = harvested.cleanText || raw;
    artifacts = harvested.artifacts;
    // No file fence → the agent's final reply is the artifact (e.g. "how are you?")
    if (!artifacts.length && reply.trim()) {
      const fallback = registerFinalResponseArtifact({
        jobId: opts.jobId,
        agentName: member.name,
        agentId: member.id,
        response: reply,
      });
      if (fallback) artifacts = [fallback];
    }
  }

  bus.emitEvent({
    type: "chat",
    agentId: member.id,
    role: "agent",
    text: reply,
  });
  if (artifacts.length) {
    bus.emitEvent({
      type: "chat",
      agentId: member.id,
      role: "system",
      text: `Ready to download: ${artifacts.map((a) => a.name).join(", ")}`,
    });
    bus.emitEvent({
      type: "orch",
      text: `${member.name} attached ${artifacts.length} artifact${artifacts.length > 1 ? "s" : ""} — use Download when ready.`,
      kind: "normal",
    });
  }
  return reply;
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
  if (runMode === "casual") {
    bus.emitEvent({
      type: "orch",
      text: "Casual mode — conversation only. Agents assume defaults and won’t ask clarifying questions.",
      kind: "normal",
    });
  } else if (runMode === "fast") {
    bus.emitEvent({
      type: "orch",
      text: "Fast mode — only Dev. Code, commit, open PR, merge to main. No QA / Merger / research.",
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
          runMode === "casual"
            ? `${member.name} jumps into the chat.`
            : `${member.name} is up next.`,
        kind: "normal",
      });

      try {
        if (!isDiscussMode(runMode) && member.id === "qa") {
          const priorDev = [...reports].reverse().find((r) => r.id === "dev");
          const { qaReport, extraReports } = await runQaWithDevLoop({
            qa: member,
            dev: byId.get("dev"),
            qaTask: job.task,
            goal: trimmedGoal,
            priorDevReport: priorDev?.report,
          });
          if (isSkipped(member.id)) {
            emitSkipped(member, job.task);
            continue;
          }
          reports.push(...extraReports);
          reports.push({ id: member.id, name: member.name, report: qaReport });
          bus.emitEvent({
            type: "orch",
            text:
              parseQaVerdict(qaReport) === "approve"
                ? `${member.name} approved — stage complete.`
                : `${member.name} finished with open findings.`,
            kind: "normal",
          });
          continue;
        }

        const report = isDiscussMode(runMode)
          ? await casualDiscuss(member, job.task, trimmedGoal, {
              jobId: job.id,
            })
          : await askThenImplement(member, job.task, trimmedGoal, {
              fast: isFastMode(runMode),
            });
        if (isSkipped(member.id)) {
          emitSkipped(member, job.task);
          continue;
        }
        reports.push({ id: member.id, name: member.name, report });
        emitStatus(
          member.id,
          "done",
          runMode === "casual" ? "Chipped in." : "Finished their part."
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
            runMode === "casual"
              ? `${member.name} replied.`
              : `${member.name} finished.`,
          kind: "normal",
        });
      } catch (err) {
        // Skip must win over CancelledError — per-agent cancel looks like a cancel
        // to the Cursor SDK, but the rest of the cycle must keep going.
        if (err instanceof SkippedError || isSkipped(member.id)) {
          emitSkipped(member, job.task);
          continue;
        }
        if (err instanceof CancelledError) throw err;
        const msg = explainCursorError(err);
        bus.emitEvent({
          type: "chat",
          agentId: member.id,
          role: "agent",
          text: msg,
        });
        emitStatus(member.id, "blocked", msg);
        // Per-agent failure: note it and continue with the next teammate
        bus.emitEvent({
          type: "orch",
          text: `${member.name} hit a snag — continuing with the next agent.`,
          kind: "normal",
        });
        bus.emitEvent({ type: "error", message: `${member.name}: ${msg}` });
      }
    }

    // Discuss-mode guests — ephemeral bubbles that smoke-vanish when done
    if (isDiscussMode(runMode) && plan.guests.length) {
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
          task: `CASUAL CONVERSATION ONLY (no codebase edits, no clarifying questions — assume defaults). Topic: ${trimmedGoal}\n\nYour angle: ${g.focus}\n\n${artifactsPromptHint()}`,
        }))
      );
      for (const g of guestReports) {
        const harvested = harvestArtifactsFromText(
          job.id,
          g.report,
          `guest-${g.name}`
        );
        const report = harvested.cleanText || g.report;
        let arts = harvested.artifacts;
        if (!arts.length && report.trim()) {
          const fallback = registerFinalResponseArtifact({
            jobId: job.id,
            agentName: g.name,
            agentId: `guest-${g.name}`,
            response: report,
          });
          if (fallback) arts = [fallback];
        }
        reports.push({
          id: `guest-${g.name}`,
          name: g.name,
          report,
        });
        bus.emitEvent({
          type: "orch",
          text: `Guest “${g.name}”: ${report.slice(0, 400)}`,
          kind: "normal",
        });
        if (arts.length) {
          bus.emitEvent({
            type: "orch",
            text: `Guest “${g.name}” attached ${arts.length} artifact${arts.length > 1 ? "s" : ""} — use Download when ready.`,
            kind: "normal",
          });
        }
      }
    }

    throwIfCancelled();

    const orch = byId.get("orchestrator") ?? {
      id: "orchestrator",
      name: "Orchestrator",
      role: "Routes work",
    };

    // Fast mode: use Dev’s report as the wrap — no extra Orchestrator LLM call
    if (isFastMode(runMode)) {
      const summary =
        reports.map((r) => r.report).join("\n\n").trim().slice(0, 280) ||
        "Fast ship complete.";
      bus.emitEvent({ type: "orch", text: summary, kind: "summary" });
      emitStatus(orch.id, "done", "Fast ship complete.");
      bus.emitEvent({ type: "success", summary });
      bus.emitEvent({ type: "done" });
      jobSummary = summary;
      jobOutcome = "done";
      return;
    }

    emitStatus(
      orch.id,
      "working",
      runMode === "casual" ? "Wrapping the chat…" : "Writing a tiny wrap-up…"
    );
    bus.emitEvent({
      type: "orch",
      text:
        runMode === "casual"
          ? "Orchestrator is wrapping the casual chat…"
          : "Orchestrator is writing a brief final summary…",
      kind: "typing",
    });

    const digest = reports
      .map((r) => `### ${r.name}\n${r.report.slice(0, 400)}`)
      .join("\n\n");

    const summaryRaw = await runAgentPrompt(
      orch,
      isDiscussMode(runMode)
        ? `You are the Orchestrator wrapping a CASUAL CONVERSATION (discussion only — nothing was built).

Topic: ${trimmedGoal}

What people said:
${digest || "(none)"}

Reply with a VERY brief synthesis:
- Exactly 1–2 short sentences
- Name the strongest direction or open question
- Plain language, no bullets, no “next steps” list
- Keep the tone conversational`
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
        label: isDiscussMode(runMode)
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
  workspace: WorkspaceTarget | null = null,
  mode: RunMode = "build"
): Promise<void> {
  const runMode = parseRunMode(mode);
  if (member.id === "orchestrator") {
    const roster =
      team.length > 0
        ? team
        : BUILTIN_ROLES.map((r) => ({
            id: r.id,
            name: r.name,
            role: r.role,
          }));
    await runOrchestration(instruction, roster, workspace, runMode);
    return;
  }

  clearCancelFlag();
  setActiveWorkspace(workspace);
  const job = startJob({
    goal: instruction.trim(),
    mode: runMode,
    workspaceUrl: workspace?.url ?? null,
  });
  bus.emitEvent({ type: "run", running: true });
  bus.emitEvent({
    type: "goal",
    goal: instruction,
    workspace: workspace
      ? { url: workspace.url, startingRef: workspace.startingRef }
      : null,
    mode: runMode,
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

    const report = isDiscussMode(runMode)
      ? await casualDiscuss(member, instruction, instruction, {
          jobId: job.id,
        })
      : await askThenImplement(member, instruction, instruction, {
          fast: isFastMode(runMode),
        });
    emitStatus(
      member.id,
      "done",
      runMode === "casual" ? "Replied." : "Finished."
    );
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
    if (err instanceof SkippedError || isSkipped(member.id)) {
      jobOutcome = "cancelled";
      jobSummary = "Skipped.";
      emitSkipped(member, instruction);
      return;
    }
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
