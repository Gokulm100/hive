import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ListedRepo } from "../api/client";
import { CharAvatar } from "./CharAvatar";
import { ORCHESTRATOR } from "../data/cast";
import type { AgentDef, AgentRuntime, OrchMessage } from "../types";
import { AddAgentModal } from "./AddAgentModal";
import { RepoPicker } from "./RepoPicker";
import {
  StoryBoard,
  StoryDetailPanel,
  type StorySelection,
} from "./StoryBoard";

type Props = {
  addAgentToken?: number;
  teamAgents: AgentDef[];
  agentState: Record<string, AgentRuntime>;
  messages: OrchMessage[];
  running: boolean;
  onSubmit: (text: string) => void;
  onReset: () => void;
  showReplayDemo?: boolean;
  onReplay: () => void;
  onStop: () => void;
  onToggleCard: (id: string) => void;
  onAddAgent: (name: string, skills: string) => void;
  successSummary?: string | null;
  showRepoPicker?: boolean;
  repos?: ListedRepo[];
  reposLoading?: boolean;
  workspaceUrl?: string;
  workspaceBranch?: string;
  workspaceCustomUrl?: string;
  workspaceLocalPath?: string;
  apiCwd?: string | null;
  onWorkspaceUrl?: (v: string) => void;
  onWorkspaceBranch?: (v: string) => void;
  onWorkspaceCustomUrl?: (v: string) => void;
  onWorkspaceLocalPath?: (v: string) => void;
};

type BoardTab = "stories" | "chat";

export function ReportsView({
  addAgentToken,
  teamAgents,
  agentState,
  messages,
  running,
  onSubmit,
  onReset,
  showReplayDemo = false,
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
  workspaceLocalPath = "",
  apiCwd = null,
  onWorkspaceUrl,
  onWorkspaceBranch,
  onWorkspaceCustomUrl,
  onWorkspaceLocalPath,
}: Props) {
  const [input, setInput] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [boardTab, setBoardTab] = useState<BoardTab>("stories");
  const [storySel, setStorySel] = useState<StorySelection>({
    key: null,
    detail: null,
    loading: false,
    error: null,
  });
  const [storyClearEpoch, setStoryClearEpoch] = useState(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (addAgentToken && addAgentToken > 0) setAddOpen(true);
  }, [addAgentToken]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    onSubmit(input.trim());
    setInput("");
  }

  function applyGoal(goal: string) {
    setInput(goal);
    setBoardTab("chat");
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
      composerRef.current?.focus();
    });
  }

  function closeStory() {
    setStorySel({
      key: null,
      detail: null,
      loading: false,
      error: null,
    });
    setStoryClearEpoch((n) => n + 1);
  }

  const chatPanel = (
    <section className="panel chat reports-chat" aria-label="Orchestrator chat">
      <div className="chat-head">
        <CharAvatar refAgent={ORCHESTRATOR} className="avatar" />
        <div>
          <h2>Orchestrator</h2>
          <p className="sub">You talk here. Subagents only report.</p>
        </div>
        <div className="agent-chat-actions chat-head-actions">
          {running ? (
            <button type="button" className="btn-danger" onClick={onStop}>
              Stop
            </button>
          ) : null}
          {showReplayDemo ? (
            <button type="button" className="btn-ghost" onClick={onReplay}>
              Replay demo
            </button>
          ) : null}
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
            Pick a Jira story, or type one below.
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
      <form className="composer composer-stacked" onSubmit={submit}>
        <label className="composer-field">
          <span className="composer-label">Goal</span>
          <textarea
            ref={composerRef}
            rows={input.length > 160 ? 5 : 3}
            placeholder={
              running
                ? "Ask while the hive is working…"
                : "What should the hive build?"
            }
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <div className="composer-footer">
          <div className="composer-tools">
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
          </div>
          <button type="submit" className="btn-primary composer-send">
            Send
          </button>
        </div>
      </form>
    </section>
  );

  const teamStrip = (
    <section className="team-strip" aria-label="Team reports">
      <div className="team-strip-head">
        <div>
          <h3>Team</h3>
          <p className="team-strip-sub">Status at a glance</p>
        </div>
        <button
          type="button"
          className="btn-ghost team-strip-add"
          onClick={() => setAddOpen(true)}
        >
          Add
        </button>
      </div>
      {showRepoPicker &&
      onWorkspaceUrl &&
      onWorkspaceBranch &&
      onWorkspaceCustomUrl &&
      onWorkspaceLocalPath ? (
        <div className="team-strip-repo">
          <RepoPicker
            compact
            repos={repos}
            loading={reposLoading}
            value={workspaceUrl}
            branch={workspaceBranch}
            customUrl={workspaceCustomUrl}
            localPath={workspaceLocalPath}
            defaultCwd={apiCwd}
            onRepo={onWorkspaceUrl}
            onBranch={onWorkspaceBranch}
            onCustomUrl={onWorkspaceCustomUrl}
            onLocalPath={onWorkspaceLocalPath}
            disabled={running}
          />
        </div>
      ) : null}
      <div className="team-strip-track" role="list">
        {teamAgents.map((a) => {
          const s = agentState[a.id];
          if (!s) return null;
          return (
            <button
              type="button"
              role="listitem"
              key={a.id}
              className={`team-chip ${s.status}${s.open ? " open" : ""}`}
              aria-expanded={s.open}
              title={s.report || a.role}
              onClick={() => onToggleCard(a.id)}
            >
              <CharAvatar refAgent={a} className="avatar" />
              <span className="team-chip-meta">
                <span className="team-chip-name">{a.name}</span>
                <span className={`chip ${s.status}`}>{s.status}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );

  return (
    <div
      className={`reports-stack${storySel.key ? " has-story" : ""} board-tab-${boardTab}`}
    >
      <div className="board-mobile-tabs" role="tablist" aria-label="Board views">
        <button
          type="button"
          role="tab"
          className="board-tab"
          aria-selected={boardTab === "stories"}
          onClick={() => setBoardTab("stories")}
        >
          Stories
        </button>
        <button
          type="button"
          role="tab"
          className="board-tab"
          aria-selected={boardTab === "chat"}
          onClick={() => setBoardTab("chat")}
        >
          Chat
        </button>
      </div>

      <div className="reports-main board-stories-pane">
        <StoryBoard
          disabled={running}
          onApplyGoal={applyGoal}
          onSelectionChange={setStorySel}
          clearEpoch={storyClearEpoch}
        />
        <aside className="story-detail-main" aria-label="Story detail">
          <StoryDetailPanel
            selection={storySel}
            disabled={running}
            onApplyGoal={applyGoal}
            onClose={closeStory}
          />
        </aside>
      </div>

      <aside className="reports-rail board-chat-pane" aria-label="Orchestrator and team">
        {chatPanel}
        {teamStrip}
      </aside>

      <AddAgentModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={onAddAgent}
      />
    </div>
  );
}
