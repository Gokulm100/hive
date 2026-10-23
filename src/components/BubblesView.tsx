import { ActiveTasks } from "./ActiveTasks";
import { AgentChat } from "./AgentChat";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { BubbleMap } from "./BubbleMap";
import { JobsList } from "./JobsList";
import type { OrchestrationApi } from "../hooks/useOrchestration";

type Props = {
  api: OrchestrationApi;
  addAgentToken?: number;
};

export function BubblesView({ api, addAgentToken }: Props) {
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
          {api.showReplayDemo ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={api.startReplay}
            >
              Replay demo
            </button>
          ) : null}
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
          addAgentToken={addAgentToken}
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
          showRepoPicker={api.engine === "live"}
          repos={api.repos}
          reposLoading={api.reposLoading}
          workspaceUrl={api.workspaceUrl}
          workspaceBranch={api.workspaceBranch}
          workspaceCustomUrl={api.workspaceCustomUrl}
          onWorkspaceUrl={api.setWorkspaceUrl}
          onWorkspaceBranch={api.setWorkspaceBranch}
          onWorkspaceCustomUrl={api.setWorkspaceCustomUrl}
          repoDisabled={api.running}
        />
        <div className="agent-chat-column">
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
      <JobsList
        jobs={api.jobs}
        onStopJob={api.stopJob}
        onDeleteJob={api.deleteJob}
      />
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
    </aside>
  );
}
