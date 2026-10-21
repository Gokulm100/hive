import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ListedRepo } from "../api/client";
import { CharAvatar } from "./CharAvatar";
import { ORCHESTRATOR } from "../data/cast";
import type { AgentDef, AgentRuntime, OrchMessage } from "../types";
import { RepoPicker } from "./RepoPicker";

type Props = {
  teamAgents: AgentDef[];
  agentState: Record<string, AgentRuntime>;
  messages: OrchMessage[];
  running: boolean;
  onSubmit: (text: string) => void;
  onReset: () => void;
  onReplay: () => void;
  onStop: () => void;
  onToggleCard: (id: string) => void;
  onAddAgent: (name: string, role: string) => void;
  successSummary?: string | null;
  showRepoPicker?: boolean;
  repos?: ListedRepo[];
  reposLoading?: boolean;
  workspaceUrl?: string;
  workspaceBranch?: string;
  workspaceCustomUrl?: string;
  onWorkspaceUrl?: (v: string) => void;
  onWorkspaceBranch?: (v: string) => void;
  onWorkspaceCustomUrl?: (v: string) => void;
};

export function ReportsView({
  teamAgents,
  agentState,
  messages,
  running,
  onSubmit,
  onReset,
  onReplay,
  onStop,
  onToggleCard,
  onAddAgent,
  successSummary,
  showRepoPicker,
  repos = [],
  reposLoading,
  workspaceUrl = "",
  workspaceBranch = "",
  workspaceCustomUrl = "",
  onWorkspaceUrl,
  onWorkspaceBranch,
  onWorkspaceCustomUrl,
}: Props) {
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    onSubmit(input.trim());
    setInput("");
  }

  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onAddAgent(name, role);
    setName("");
    setRole("");
  }

  return (
    <>
      <section className="panel chat" aria-label="Orchestrator chat">
        <div className="chat-head">
          <CharAvatar refAgent={ORCHESTRATOR} className="avatar" />
          <div>
            <h2>Orchestrator</h2>
            <p className="sub">You talk here. Subagents only report.</p>
          </div>
        </div>
        <div className="messages" ref={messagesRef}>
          {successSummary ? (
            <div className="success-banner show" role="status">
              <p className="eyebrow">All tasks complete</p>
              <p>{successSummary}</p>
            </div>
          ) : null}
          {!messages.length ? (
            <div className="empty">
              Give the <strong>Orchestrator</strong> a goal.
              <br />
              Try: plan a landing page for a specialty coffee brand.
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`msg ${m.kind} ${m.extraClass ?? ""}`.trim()}
              >
                {m.text}
              </div>
            ))
          )}
        </div>
        {showRepoPicker && onWorkspaceUrl && onWorkspaceBranch && onWorkspaceCustomUrl ? (
          <RepoPicker
            repos={repos}
            loading={reposLoading}
            value={workspaceUrl}
            branch={workspaceBranch}
            customUrl={workspaceCustomUrl}
            onRepo={onWorkspaceUrl}
            onBranch={onWorkspaceBranch}
            onCustomUrl={onWorkspaceCustomUrl}
            disabled={running}
          />
        ) : null}
        <form className="composer" onSubmit={submit}>
          <button
            type="button"
            className="btn-ghost"
            title="Reset run"
            onClick={onReset}
          >
            Reset
          </button>
          {running ? (
            <button
              type="button"
              className="btn-danger"
              title="Stop current work"
              onClick={onStop}
            >
              Stop
            </button>
          ) : null}
          <input
            type="text"
            placeholder={
              running
                ? "Ask while running (side helper)…"
                : "Tell the Orchestrator what to build…"
            }
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="btn-primary">
            Send
          </button>
        </form>
      </section>

      <aside className="rail" aria-label="Subagent reports">
        <div className="rail-head">
          <h3>Team reports</h3>
          <div className="agent-chat-actions">
            {running ? (
              <button type="button" className="btn-danger" onClick={onStop}>
                Stop
              </button>
            ) : null}
            <button type="button" className="btn-ghost" onClick={onReplay}>
              Replay demo
            </button>
          </div>
        </div>
        <form className="add-agent-bar-reports" onSubmit={add}>
          <input
            type="text"
            placeholder="New agent name"
            maxLength={24}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Role"
            maxLength={40}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
          <button type="submit" className="btn-primary">
            Add
          </button>
        </form>
        <div className="cards">
          {teamAgents.map((a) => {
            const s = agentState[a.id];
            if (!s) return null;
            return (
              <button
                type="button"
                key={a.id}
                className={`card ${s.status} ${s.open ? "open" : ""}`}
                aria-expanded={s.open}
                onClick={() => onToggleCard(a.id)}
              >
                <div className="card-top">
                  <CharAvatar refAgent={a} className="avatar" />
                  <div className="meta">
                    <p className="name">
                      {a.name}
                      {a.custom ? " · custom" : ""}
                    </p>
                    <p className="role">{a.role}</p>
                  </div>
                  <span className={`chip ${s.status}`}>{s.status}</span>
                </div>
                <p className="report">
                  {s.status === "working" ? (
                    <span className="pulse">Working on it</span>
                  ) : (
                    s.report
                  )}
                </p>
                <div className="report-tag">↑ Reported to Orchestrator</div>
              </button>
            );
          })}
        </div>
      </aside>
    </>
  );
}
