import { ActiveTasks } from "./components/ActiveTasks";
import { ArtifactsPanel } from "./components/ArtifactsPanel";
import { AuthGate } from "./components/AuthGate";
import { Header } from "./components/Header";
import { JobsList } from "./components/JobsList";
import { ReportsView } from "./components/ReportsView";
import { BubblesView } from "./components/BubblesView";
import { useCallback, useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { useOrchestration } from "./hooks/useOrchestration";
import { useUiSounds } from "./hooks/useUiSounds";
import { play } from "./lib/sounds";
import type { AuthUser } from "./api/client";

type HiveAppProps = {
  authUser: AuthUser;
  onSignOut: () => void;
};

function HiveApp({ authUser, onSignOut }: HiveAppProps) {
  const api = useOrchestration();
  useUiSounds(api.agentState);
  const [addAgentToken, setAddAgentToken] = useState(0);
  const requestAddAgent = useCallback(() => {
    setAddAgentToken((t) => t + 1);
  }, []);

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
        authUser={authUser}
        onSignOut={onSignOut}
        onRequestAddAgent={requestAddAgent}
      />

      <div className="layout">
        {api.view === "reports" ? (
          <aside className="reports-panel" aria-label="Reports">
            <ReportsView
              addAgentToken={addAgentToken}
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
                api.setView("bubbles");
              }}
              onSkip={api.skipAgent}
            />
          </aside>
        ) : (
          <BubblesView api={api} addAgentToken={addAgentToken} />
        )}
      </div>
    </div>
  );
}

export default function App() {
  const auth = useAuth();

  if (auth.phase === "loading") {
    return (
      <div className="auth-gate auth-gate--loading" role="main">
        <p className="auth-loading">Loading…</p>
      </div>
    );
  }

  if (auth.phase === "guest" || !auth.user) {
    return (
      <AuthGate
        sessionExpired={auth.sessionExpired}
        githubEnabled={auth.githubEnabled}
        authError={auth.authError}
        onContinueAsGuest={auth.continueAsGuest}
      />
    );
  }

  return (
    <HiveApp
      authUser={auth.user}
      onSignOut={() => {
        void auth.signOut();
      }}
    />
  );
}
