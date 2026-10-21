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
        apiError={api.apiError}
      />

      {api.view === "reports" ? (
        <div className="legend" aria-label="Status legend">
          <span>
            <i className="dot idle" /> Idle
          </span>
          <span>
            <i className="dot working" /> Working
          </span>
          <span>
            <i className="dot done" /> Done
          </span>
          <span>
            <i className="dot blocked" /> Blocked
          </span>
        </div>
      ) : null}

      <div className="layout">
        {api.view === "reports" ? (
          <>
            <div className="reports-with-tasks">
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
                onSelect={(id) => {
                  api.selectAgent(id);
                  api.ensureChatSeed(id);
                  api.setView("bubbles");
                }}
              />
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
              />
            </div>
          </>
        ) : (
          <BubblesView api={api} />
        )}
      </div>
    </div>
  );
}
