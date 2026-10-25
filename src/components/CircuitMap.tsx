import { useEffect, useMemo, useRef, useState } from "react";
import type { ListedRepo } from "../api/client";
import { charHtml } from "../data/chars";
import { ORCHESTRATOR } from "../data/cast";
import {
  circuitTracePath,
  layoutCircuit,
} from "../lib/circuitLayout";
import type { AgentDef, AgentRuntime } from "../types";
import { AddAgentModal } from "./AddAgentModal";
import { RepoPicker } from "./RepoPicker";
import { StoryPicker } from "./StoryPicker";

function traceClass(status: string, ephemeral = false) {
  const parts = ["circuit-trace"];
  if (ephemeral) parts.push("ephemeral");
  if (status === "working") parts.push("active");
  else if (status === "done") parts.push("done");
  else if (status === "blocked") parts.push("blocked");
  return parts.join(" ");
}

function nodeClass(
  id: string,
  isHub: boolean,
  status: string,
  selected: string | null,
  flashIds: Set<string>,
  celebrate: boolean,
  ephemeral = false
) {
  const sel = selected === id ? "selected" : "";
  const flash = flashIds.has(id) ? "flash" : "";
  const glow =
    selected === id || status === "working" || celebrate ? "glow" : "";
  const cheer = celebrate && isHub ? "celebrate" : "";
  return `circuit-node ${isHub ? "hub" : ""} ${status} ${flash} ${sel} ${glow} ${cheer} ${ephemeral ? "ephemeral" : ""}`
    .replace(/\s+/g, " ")
    .trim();
}

type Props = {
  addAgentToken?: number;
  teamAgents: AgentDef[];
  agentState: Record<string, AgentRuntime>;
  selected: string | null;
  flashIds: Set<string>;
  mapTick: number;
  celebrateOrch: boolean;
  onSelect: (id: string) => void;
  onAddAgent?: (name: string, skills: string) => void;
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
  repoDisabled?: boolean;
  onApplyStoryGoal?: (goal: string) => void;
};

export function CircuitMap({
  addAgentToken,
  teamAgents,
  agentState,
  selected,
  flashIds,
  mapTick,
  celebrateOrch,
  onSelect,
  onAddAgent,
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
  repoDisabled,
  onApplyStoryGoal,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 420 });
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (addAgentToken) setAddOpen(true);
  }, [addAgentToken]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({
        w: Math.max(320, r.width),
        h: Math.max(280, r.height),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const allAgents = useMemo(
    () => [ORCHESTRATOR, ...teamAgents],
    [teamAgents]
  );

  const agentById = useMemo(() => {
    const m = new Map<string, AgentDef>();
    for (const a of allAgents) m.set(a.id, a);
    return m;
  }, [allAgents]);

  const layout = useMemo(
    () => layoutCircuit(allAgents, size.w, size.h),
    [allAgents, size.w, size.h, mapTick]
  );

  const posById = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of layout.nodes) m.set(n.id, { x: n.x, y: n.y });
    return m;
  }, [layout.nodes]);

  return (
    <div className="map-shell circuit-shell">
      <div className="add-agent-bar">
        {showRepoPicker &&
        onWorkspaceUrl &&
        onWorkspaceBranch &&
        onWorkspaceCustomUrl &&
        onWorkspaceLocalPath ? (
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
            disabled={repoDisabled}
          />
        ) : (
          <span className="add-agent-bar-spacer" />
        )}
        {onAddAgent ? (
          <button
            type="button"
            className="btn-primary add-agent-trigger"
            onClick={() => setAddOpen(true)}
          >
            Add agent
          </button>
        ) : (
          <span className="add-agent-bar-spacer" />
        )}
      </div>
      {onApplyStoryGoal ? (
        <StoryPicker
          compact
          disabled={repoDisabled}
          onApplyGoal={onApplyStoryGoal}
        />
      ) : null}
      <div className="map-canvas-wrap circuit-canvas-wrap" ref={wrapRef}>
        <div
          className="map-canvas circuit-canvas"
          style={{ minWidth: layout.width }}
          aria-hidden={false}
        >
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            preserveAspectRatio="xMidYMid meet"
            className="circuit-svg"
            aria-hidden="true"
          >
            <defs>
              <filter id="circuit-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {layout.edges.map((e) => {
              const from = posById.get(e.from);
              const to = posById.get(e.to);
              if (!from || !to) return null;
              const target = agentById.get(e.to);
              const status = agentState[e.to]?.status ?? "idle";
              const d = circuitTracePath(from.x, from.y, to.x, to.y);
              return (
                <path
                  key={`${e.from}-${e.to}`}
                  d={d}
                  className={traceClass(status, !!target?.ephemeral)}
                  filter="url(#circuit-glow)"
                />
              );
            })}
          </svg>
          {layout.nodes.map((n) => {
            const agent = agentById.get(n.id);
            if (!agent) return null;
            const isHub = !!agent.hub || n.id === "orchestrator";
            const status = agentState[n.id]?.status ?? "idle";
            return (
              <button
                key={n.id}
                type="button"
                className={nodeClass(
                  n.id,
                  isHub,
                  status,
                  selected,
                  flashIds,
                  celebrateOrch && isHub,
                  !!agent.ephemeral
                )}
                data-id={n.id}
                style={{
                  left: `${n.x}px`,
                  top: `${n.y}px`,
                }}
                aria-label={`${agent.name}, ${status}${agent.ephemeral ? ", temporary helper" : ""}`}
                onClick={() => onSelect(n.id)}
              >
                <span className="circuit-node-glow" aria-hidden="true" />
                <span className="circuit-chip" aria-hidden="true">
                  <span
                    className="circuit-char"
                    dangerouslySetInnerHTML={{
                      __html: charHtml(agent, agent.anim),
                    }}
                  />
                </span>
                <span className="label">{agent.name}</span>
                <span className="mini-chip">
                  {celebrateOrch && isHub
                    ? "success"
                    : agent.ephemeral
                      ? status === "done"
                        ? "done"
                        : "helper"
                      : status}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {onAddAgent ? (
        <AddAgentModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onAdd={onAddAgent}
        />
      ) : null}
    </div>
  );
}
