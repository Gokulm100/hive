import type { RunMode, WorkspacePayload } from "../api/client";
import { CharAvatar } from "./CharAvatar";
import { runOverallProgressPct } from "../lib/bubbleFill";
import type { AgentDef, AgentRuntime, PlannedTask } from "../types";

type Progress = { active: boolean; steps: number; label: string };

type Props = {
  agents: AgentDef[];
  agentState: Record<string, AgentRuntime>;
  workProgress: Record<string, Progress>;
  awaitingIds: Set<string>;
  selected: string | null;
  currentGoal: string | null;
  plannedTasks: PlannedTask[];
  running: boolean;
  successSummary?: string | null;
  activeWorkspace?: WorkspacePayload | null;
  runMode?: RunMode;
  onSelect: (id: string) => void;
  onSkip?: (id: string) => void;
};

function statusLabel(status: string, awaiting: boolean): string {
  if (awaiting) return "needs you";
  if (status === "working") return "working";
  if (status === "blocked") return "blocked";
  return status;
}

export function ActiveTasks({
  agents,
  agentState,
  workProgress,
  awaitingIds,
  selected,
  currentGoal,
  plannedTasks,
  running,
  successSummary,
  activeWorkspace,
  runMode = "build",
  onSelect,
  onSkip,
}: Props) {
  const casual = runMode === "casual";
  const byId = new Map(agents.map((a) => [a.id, a]));

  const activeLive = agents.filter((a) => {
    const s = agentState[a.id]?.status;
    return s === "working" || s === "blocked";
  });

  const upcoming = plannedTasks.filter((p) => p.phase === "upcoming");
  const plannedActive = plannedTasks.filter((p) => p.phase === "active");
  const skipped = plannedTasks.filter((p) => p.phase === "skipped");

  // Prefer live working agents; fall back to plan “active” if status lags
  const activeCards =
    activeLive.length > 0
      ? activeLive
      : plannedActive
          .map((p) => byId.get(p.id))
          .filter((a): a is AgentDef => !!a);

  const doneCount = plannedTasks.filter(
    (p) => p.phase === "done" || p.phase === "skipped"
  ).length;
  const totalPlanned = plannedTasks.length;
  const progressPct = runOverallProgressPct({ plannedTasks, running });

  const empty =
    !currentGoal && !activeCards.length && !upcoming.length && !successSummary;

  if (empty) {
    return (
      <section className="active-tasks" aria-label="Task board">
        <div className="active-tasks-head">
          <h3>Task board</h3>
          <span className="hint">Give the hive a goal to populate this</span>
        </div>
      </section>
    );
  }

  return (
    <section className="active-tasks" aria-label="Task board">
      <div className="active-tasks-head">
        <h3>Task board</h3>
        <span className="hint">
          {running
            ? "Run in progress — skip any agent or stage"
            : successSummary
              ? "Run complete"
              : "Latest plan"}
        </span>
      </div>

      {currentGoal || successSummary ? (
        <article
          className={`goal-card${successSummary ? " complete" : ""}${
            running ? " running" : ""
          }`}
        >
          <p className="goal-eyebrow">
            {successSummary
              ? casual
                ? "Wrapped"
                : "Delivered"
              : casual
                ? "Casual"
                : "Overall functionality"}
          </p>
          <h4 className="goal-title">
            {successSummary
              ? casual
                ? "Chat wrapped"
                : "Hive finished this run"
              : casual
                ? "Conversation in progress"
                : "Being implemented"}
          </h4>
          <p className="goal-body">{successSummary || currentGoal}</p>
          {activeWorkspace?.url ? (
            <p className="goal-repo">
              Repo:{" "}
              <a href={activeWorkspace.url} target="_blank" rel="noreferrer">
                {activeWorkspace.url.replace(/^https?:\/\/github\.com\//i, "")}
              </a>
              {activeWorkspace.startingRef
                ? ` @ ${activeWorkspace.startingRef}`
                : ""}
            </p>
          ) : activeWorkspace?.localPath ? (
            <p className="goal-repo" title={activeWorkspace.localPath}>
              Local: {activeWorkspace.localPath}
            </p>
          ) : (
            <p className="goal-repo muted">Workspace: local server folder</p>
          )}
          {totalPlanned > 0 ? (
            <div className="goal-meta">
              <div className="goal-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, progressPct)}%` }} />
              </div>
              <p className="goal-count">
                {doneCount}/{totalPlanned} stages finished
                {skipped.length ? ` · ${skipped.length} skipped` : ""}
              </p>
            </div>
          ) : running ? (
            <p className="goal-count">
              {casual ? "Opening the chat…" : "Planning the lineup…"}
            </p>
          ) : null}
        </article>
      ) : null}

      {activeCards.length > 0 ? (
        <div className="task-section">
          <p className="task-section-label">Running now</p>
          <div className="active-task-grid">
            {activeCards.map((a) => {
              const runtime = agentState[a.id];
              const status = runtime?.status || "working";
              const awaiting = awaitingIds.has(a.id);
              const progress = workProgress[a.id];
              const planned = plannedTasks.find((p) => p.id === a.id);
              const detail =
                progress?.label?.trim() ||
                runtime?.report?.trim() ||
                planned?.task ||
                (awaiting
                  ? "Waiting for your choices before continuing."
                  : "Working…");
              const steps = progress?.steps ?? 0;
              const canSkip =
                !!onSkip &&
                running &&
                a.id !== "orchestrator" &&
                planned?.phase !== "skipped";

              return (
                <article
                  key={a.id}
                  className={`active-task-card ${status}${
                    awaiting ? " awaiting" : ""
                  }${selected === a.id ? " selected" : ""}${
                    a.ephemeral ? " ephemeral" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="active-task-main"
                    onClick={() => onSelect(a.id)}
                  >
                    <div className="active-task-top">
                      <CharAvatar refAgent={a} className="avatar" />
                      <div className="meta">
                        <p className="name">
                          {a.name}
                          {a.ephemeral ? " · guest" : ""}
                        </p>
                        <p className="role">{a.role}</p>
                      </div>
                      <span className={`chip ${awaiting ? "blocked" : status}`}>
                        {statusLabel(status, awaiting)}
                      </span>
                    </div>
                    <p className="active-task-detail">{detail}</p>
                    {status === "working" && !awaiting ? (
                      <div className="active-task-bar" aria-hidden="true">
                        <span
                          style={{
                            width: `${Math.min(92, 14 + steps * 7)}%`,
                          }}
                        />
                      </div>
                    ) : null}
                    {awaiting ? (
                      <p className="active-task-cta">Answer to unblock →</p>
                    ) : null}
                  </button>
                  {canSkip ? (
                    <button
                      type="button"
                      className="skip-stage-btn"
                      onClick={() => onSkip(a.id)}
                      title={`Skip ${a.name} and continue`}
                    >
                      Skip
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {upcoming.length > 0 ? (
        <div className="task-section">
          <p className="task-section-label">Upcoming</p>
          <div className="active-task-grid">
            {upcoming.map((p) => {
              const a = byId.get(p.id);
              const canSkip =
                !!onSkip && running && p.id !== "orchestrator";
              return (
                <article
                  key={p.id}
                  className={`active-task-card upcoming${
                    selected === p.id ? " selected" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="active-task-main"
                    onClick={() => onSelect(p.id)}
                  >
                    <div className="active-task-top">
                      <CharAvatar refAgent={a} className="avatar" />
                      <div className="meta">
                        <p className="name">{a?.name || p.id}</p>
                        <p className="role">{a?.role || "Teammate"}</p>
                      </div>
                      <span className="chip idle">queued</span>
                    </div>
                    <p className="active-task-detail">{p.task}</p>
                  </button>
                  {canSkip ? (
                    <button
                      type="button"
                      className="skip-stage-btn"
                      onClick={() => onSkip(p.id)}
                      title={`Skip ${a?.name || p.id} stage`}
                    >
                      Skip
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {skipped.length > 0 ? (
        <div className="task-section">
          <p className="task-section-label">Skipped</p>
          <div className="active-task-grid">
            {skipped.map((p) => {
              const a = byId.get(p.id);
              return (
                <article key={p.id} className="active-task-card skipped">
                  <div className="active-task-main static">
                    <div className="active-task-top">
                      <CharAvatar refAgent={a} className="avatar" />
                      <div className="meta">
                        <p className="name">{a?.name || p.id}</p>
                        <p className="role">{a?.role || "Teammate"}</p>
                      </div>
                      <span className="chip idle">skipped</span>
                    </div>
                    <p className="active-task-detail">{p.task}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
