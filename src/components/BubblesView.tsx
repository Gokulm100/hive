import { ActiveTasks } from "./ActiveTasks";
import { AgentChat } from "./AgentChat";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { BubbleMap } from "./BubbleMap";
import { DetailLog } from "./DetailLog";
import { JobsList } from "./JobsList";
import { RepoPicker } from "./RepoPicker";
import type { OrchestrationApi } from "../hooks/useOrchestration";

type Props = {
  api: OrchestrationApi;
};

export function BubblesView({ api }: Props) {
  const agent = api.selected ? api.findAgent(api.selected) : undefined;
  const chatMsgs = api.selected ? api.chats[api.selected] ?? [] : [];

  return (
    <aside className="map-panel" aria-label="Agent bubble map">
      <div className="rail-head">
        <h3>Team map</h3>
        <div className="agent-chat-actions">
          {api.running ? (
            <button
              type="button"
              className="btn-danger"
              onClick={api.stopRun}
            >
              Stop
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost"
            onClick={api.startReplay}
          >
            Replay demo
          </button>
        </div>
      </div>
      {api.successSummary ? (
        <div className="success-banner show" role="status">
          <p className="eyebrow">All tasks complete</p>
          <p>{api.successSummary}</p>
        </div>
      ) : null}
      <div className="map-stack">
        <BubbleMap
          teamAgents={api.mapAgents}
          agentState={api.agentState}
          selected={api.selected}
          flashIds={api.flashIds}
          mapTick={api.mapTick}
          celebrateOrch={api.celebrateOrch}
          onSelect={(id) => {
            api.selectAgent(id);
            api.ensureChatSeed(id);
          }}
          onPersistPos={api.persistBubblePos}
          onAddAgent={api.addAgent}
        />
        <div className="agent-chat-column">
          {api.engine === "live" ? (
            <RepoPicker
              repos={api.repos}
              loading={api.reposLoading}
              value={api.workspaceUrl}
              branch={api.workspaceBranch}
              customUrl={api.workspaceCustomUrl}
              onRepo={api.setWorkspaceUrl}
              onBranch={api.setWorkspaceBranch}
              onCustomUrl={api.setWorkspaceCustomUrl}
              disabled={api.running}
            />
          ) : null}
          <AgentChat
            selected={api.selected}
            agent={agent}
            messages={chatMsgs}
            running={api.running}
            agentStatus={
              api.selected ? api.agentState[api.selected]?.status : undefined
            }
            progress={
              api.selected ? api.workProgress[api.selected] ?? null : null
            }
            awaiting={
              !!api.selected && api.awaitingIds.has(api.selected)
            }
            questions={
              api.selected ? api.pendingQuestions[api.selected] ?? [] : []
            }
            onClose={() => api.selectAgent(null)}
            onRemove={() => {
              if (api.selected) api.removeAgent(api.selected);
            }}
            onSend={(text) => {
              if (api.selected) api.instructAgent(api.selected, text);
            }}
            onAnswerQuestions={(answers, note) => {
              if (api.selected) api.answerQuestions(api.selected, answers, note);
            }}
            onStop={api.stopRun}
            onSkip={
              api.selected && api.selected !== "orchestrator"
                ? () => api.skipAgent(api.selected!)
                : undefined
            }
          />
        </div>
      </div>
      <JobsList jobs={api.jobs} />
      <ArtifactsPanel
        artifacts={api.artifacts}
        onRemoved={api.removeArtifact}
      />
      <ActiveTasks
        agents={api.cast}
        agentState={api.agentState}
        workProgress={api.workProgress}
        awaitingIds={api.awaitingIds}
        selected={api.selected}
        currentGoal={api.currentGoal}
        plannedTasks={api.plannedTasks}
        running={api.running}
        successSummary={api.successSummary}
        activeWorkspace={api.activeWorkspace}
        runMode={api.runMode}
        onSelect={(id) => {
          api.selectAgent(id);
          api.ensureChatSeed(id);
        }}
        onSkip={api.skipAgent}
      />
      <DetailLog
        cast={api.cast}
        agentState={api.agentState}
        activityLog={api.activityLog}
      />
    </aside>
  );
}
