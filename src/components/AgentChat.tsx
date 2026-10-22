import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CharAvatar } from "./CharAvatar";
import { humanizeAgentChat } from "../lib/humanizeChat";
import type {
  AgentDef,
  AgentStatus,
  ChatMessage,
  ClarifyingQuestion,
  QuestionAnswer,
} from "../types";
import { AgentQuestionForm } from "./AgentQuestionForm";

type Props = {
  selected: string | null;
  agent: AgentDef | undefined;
  messages: ChatMessage[];
  running: boolean;
  agentStatus?: AgentStatus;
  progress?: { active: boolean; steps: number; label: string } | null;
  awaiting: boolean;
  questions: ClarifyingQuestion[];
  onClose: () => void;
  onRemove: () => void;
  onSend: (text: string) => void;
  onAnswerQuestions: (
    answers: QuestionAnswer[],
    globalNote: string
  ) => void;
  onStop: () => void;
  onSkip?: () => void;
};

export function AgentChat({
  selected,
  agent,
  messages,
  running,
  agentStatus,
  progress,
  awaiting,
  questions,
  onClose,
  onRemove,
  onSend,
  onAnswerQuestions,
  onStop,
  onSkip,
}: Props) {
  const [text, setText] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const showForm = awaiting && questions.length > 0;
  const showProgress =
    !showForm &&
    !!selected &&
    (progress?.active || agentStatus === "working");

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role !== "process"),
    [messages]
  );

  const barPct = Math.min(92, 12 + (progress?.steps ?? 0) * 7);

  useEffect(() => {
    setText("");
  }, [selected]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleMessages, selected, showForm, questions, showProgress]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected || !text.trim() || showForm) return;
    onSend(text.trim());
    setText("");
  }

  return (
    <section className="agent-chat" aria-label="Selected agent chat">
      <div className="agent-chat-head">
        <div className="agent-chat-who">
          <CharAvatar refAgent={agent} className="avatar" />
          <div className="meta">
            <p className="name">{agent ? agent.name : "Select an agent"}</p>
            <p className="sub">
              {agent
                ? awaiting
                  ? `${agent.role} · waiting for your choices`
                  : agentStatus === "working" || progress?.active
                    ? `${agent.role} · working`
                    : running
                      ? `${agent.role} · team run in progress`
                      : agent.role
                : "Click any bubble — including Orchestrator"}
            </p>
          </div>
        </div>
        <div className="agent-chat-actions">
          {running &&
          onSkip &&
          selected &&
          selected !== "orchestrator" &&
          (awaiting ||
            agentStatus === "working" ||
            agentStatus === "blocked") ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={onSkip}
              title="Skip this agent and continue the run"
            >
              Skip
            </button>
          ) : null}
          {running ? (
            <button
              type="button"
              className="btn-danger"
              onClick={onStop}
              title="Stop the whole run"
            >
              Stop
            </button>
          ) : null}
          {agent?.custom && !agent.ephemeral ? (
            <button type="button" className="btn-danger" onClick={onRemove}>
              Remove
            </button>
          ) : null}
          <button
            type="button"
            className="pop-close"
            aria-label="Clear selection"
            disabled={!selected}
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
      <div className="agent-chat-thread" ref={threadRef}>
        {!selected ? (
          <div className="chat-empty">
            Click Orchestrator or any teammate. They ask choices before
            working. Mid-work chat spins up a side helper; use Stop to cancel.
          </div>
        ) : (
          <>
            {visibleMessages.map((m, i) => (
              <div
                key={`${m.role}-${i}-${m.text.slice(0, 12)}`}
                className={`agent-line ${m.role}${m.typing ? " typing" : ""}`}
              >
                {humanizeAgentChat(m.text, m.role)}
              </div>
            ))}
            {showProgress ? (
              <div
                className="agent-progress"
                role="status"
                aria-live="polite"
                aria-label={`${agent?.name ?? "Agent"} working`}
              >
                <div className="agent-progress-track">
                  <div
                    className="agent-progress-fill"
                    style={{ width: `${barPct}%` }}
                  />
                  <div className="agent-progress-shimmer" />
                </div>
                <p className="agent-progress-label">Working…</p>
              </div>
            ) : null}
            {showForm && agent ? (
              <AgentQuestionForm
                agentName={agent.name}
                questions={questions}
                onSubmit={onAnswerQuestions}
              />
            ) : null}
          </>
        )}
      </div>
      {!showForm ? (
        <form className="agent-chat-composer" onSubmit={submit}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              !selected
                ? "Select an agent first…"
                : awaiting
                  ? `Answer ${agent?.name}’s questions…`
                  : agentStatus === "working"
                    ? `Ask ${agent?.name} now (side helper)…`
                    : agent?.hub
                      ? "Give the Orchestrator a goal…"
                      : `Message ${agent?.name}…`
            }
            autoComplete="off"
            disabled={!selected}
          />
          <button type="submit" className="btn-primary" disabled={!selected}>
            Send
          </button>
        </form>
      ) : null}
    </section>
  );
}
