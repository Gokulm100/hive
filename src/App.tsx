import { ActiveTasks } from "./components/ActiveTasks";
import { Header } from "./components/Header";
import { ReportsView } from "./components/ReportsView";
import { BubblesView } from "./components/BubblesView";
import { useOrchestration } from "./hooks/useOrchestration";
import { useUiSounds } from "./hooks/useUiSounds";
import { play } from "./lib/sounds";

export default function App() {
  const api = useOrchestration();
  useUiSounds(api.agentState);

  return (
    <div className="app">
      <Header
        view={api.view}
        onView={(v) => {
          play("toggle");
          api.setView(v);
        }}
        engine={api.engine}
        onEngine={(e) => {
          play("toggle");
          api.setEngine(e);
        }}
        runMode={api.runMode}
        onRunMode={(m) => {
          play("toggle");
          api.setRunMode(m);
        }}
        apiError={api.apiError}
      />

      <div className="layout">
        {api.view === "reports" ? (
          <aside className="reports-panel" aria-label="Reports">
            <ReportsView
              teamAgents={api.teamAgents}
              agentState={api.agentState}
              messages={api.messages}
              running={api.running}
              onSubmit={api.submitGoal}
              onReset={() => api.resetAll(true)}
              onReplay={api.startReplay}
              onStop={api.stopRun}
              onToggleCard={api.toggleCard}
              onAddAgent={api.addAgent}
              successSummary={api.successSummary}
              showRepoPicker={api.engine === "live"}
              repos={api.repos}
              reposLoading={api.reposLoading}
              workspaceUrl={api.workspaceUrl}
              workspaceBranch={api.workspaceBranch}
              workspaceCustomUrl={api.workspaceCustomUrl}
              onWorkspaceUrl={api.setWorkspaceUrl}
              onWorkspaceBranch={api.setWorkspaceBranch}
              onWorkspaceCustomUrl={api.setWorkspaceCustomUrl}
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
                api.setView("bubbles");
              }}
              onSkip={api.skipAgent}
            />
          </aside>
        ) : (
          <BubblesView api={api} />
        )}
      </div>
    </div>
  );
}
