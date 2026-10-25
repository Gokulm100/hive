import type { AgentStatus, PlannedTask, PlannedTaskPhase } from "../types.js";

export type WorkProgressSlice = {
  active: boolean;
  steps: number;
  label: string;
};

/** Active-band fill from process-step count (matches chat progress curve). */
export function stepsFillWithinBand(steps: number, bandMin: number, bandMax: number): number {
  const span = Math.max(0, bandMax - bandMin);
  const within = Math.min(span, Math.max(0, steps) * 7);
  return Math.round(bandMin + within);
}

export function agentBubbleFillPct(input: {
  status: AgentStatus;
  taskPhase?: PlannedTaskPhase | null;
  progress?: WorkProgressSlice | null;
  ephemeral?: boolean;
}): number {
  const { status, taskPhase, progress, ephemeral } = input;

  if (status === "done") return 100;

  const phase: PlannedTaskPhase | "none" =
    taskPhase ??
    (status === "working" || status === "blocked"
      ? "active"
      : status === "idle"
        ? "upcoming"
        : "none");

  if (phase === "done" || phase === "skipped") return 100;

  if (phase === "upcoming") {
    return 0;
  }

  if (phase === "active" || status === "working" || status === "blocked") {
    const bandMin = 12;
    const bandMax = ephemeral ? 85 : 92;
    return stepsFillWithinBand(progress?.steps ?? 0, bandMin, bandMax);
  }

  return 0;
}

/** Overall run progress percent — shared with the task board goal bar. */
export function runOverallProgressPct(input: {
  plannedTasks: PlannedTask[];
  running: boolean;
}): number {
  const { plannedTasks, running } = input;
  const doneCount = plannedTasks.filter(
    (p) => p.phase === "done" || p.phase === "skipped"
  ).length;
  const plannedActive = plannedTasks.filter((p) => p.phase === "active");
  const totalPlanned = plannedTasks.length;

  if (totalPlanned > 0) {
    return Math.round(
      ((doneCount + plannedActive.length * 0.45) / totalPlanned) * 100
    );
  }

  return running ? 8 : 0;
}

/** Overall run progress for the Orchestrator hub bubble. */
export function orchestratorBubbleFillPct(input: {
  plannedTasks: PlannedTask[];
  running: boolean;
  celebrate?: boolean;
}): number {
  if (input.celebrate) return 100;
  return runOverallProgressPct({
    plannedTasks: input.plannedTasks,
    running: input.running,
  });
}

export function bubbleFillPctForId(
  agentId: string,
  ctx: {
    agentState: Record<string, { status: AgentStatus }>;
    plannedTasks: PlannedTask[];
    workProgress: Record<string, WorkProgressSlice>;
    running: boolean;
    celebrateOrch: boolean;
    ephemeral?: boolean;
  }
): number {
  if (agentId === "orchestrator") {
    return orchestratorBubbleFillPct({
      plannedTasks: ctx.plannedTasks,
      running: ctx.running,
      celebrate: ctx.celebrateOrch,
    });
  }

  const status = ctx.agentState[agentId]?.status ?? "idle";
  const taskPhase = ctx.plannedTasks.find((p) => p.id === agentId)?.phase ?? null;

  return agentBubbleFillPct({
    status,
    taskPhase,
    progress: ctx.workProgress[agentId] ?? null,
    ephemeral: ctx.ephemeral,
  });
}
