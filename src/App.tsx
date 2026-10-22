import { useEffect, useRef, useState } from "react";
import { ActiveTasks } from "./components/ActiveTasks";
import { ArtifactsPanel } from "./components/ArtifactsPanel";
import { AuthModal } from "./components/AuthModal";
import { Header } from "./components/Header";
import { JobsList } from "./components/JobsList";
import { ReportsView } from "./components/ReportsView";
import { BubblesView } from "./components/BubblesView";
import { useAuth } from "./hooks/useAuth";
import { useOrchestration, type EngineMode } from "./hooks/useOrchestration";
import { useUiSounds } from "./hooks/useUiSounds";
import { play } from "./lib/sounds";

export default function App() {
  const auth = useAuth();
  const api = useOrchestration({ liveAuthed: auth.isLoggedIn });
  useUiSounds(api.agentState);

  const [authOpen, setAuthOpen] = useState(false);
  const [authReason, setAuthReason] = useState<string | undefined>();
  const pendingLiveRef = useRef(false);

  useEffect(() => {
    if (auth.loading) return;
    if (api.engine === "live" && !auth.isLoggedIn) {
      api.setEngine("demo");
    }
  }, [auth.loading, auth.isLoggedIn, api]);

  function requestLive() {
    pendingLiveRef.current = true;
    setAuthReason("Live mode needs you to log in first.");
    setAuthOpen(true);
  }

  function handleEngine(e: EngineMode) {
    play("toggle");
    if (e === "live" && !auth.isLoggedIn) {
      requestLive();
      return;
    }
    api.setEngine(e);
  }

  async function handleLogout() {
    play("toggle");
    await auth.logout();
    api.setEngine("demo");
  }

  async function afterAuth() {
    if (pendingLiveRef.current) {
      pendingLiveRef.current = false;
      api.setEngine("live");
    }
  }

  return (
    <div className="app">
      <Header
        view={api.view}
        onView={(v) => {
          play("toggle");
          api.setView(v);
        }}
        engine={api.engine}
        onEngine={handleEngine}
        runMode={api.runMode}
        onRunMode={(m) => {
          play("toggle");
          api.setRunMode(m);
        }}
        apiError={api.apiError}
        userEmail={auth.user?.email ?? null}
        onLoginClick={() => {
          pendingLiveRef.current = false;
          setAuthReason(undefined);
          setAuthOpen(true);
        }}
        onLogout={auth.isLoggedIn ? handleLogout : undefined}
      />

      <AuthModal
        open={authOpen}
        onClose={() => {
          pendingLiveRef.current = false;
          setAuthOpen(false);
        }}
        reason={authReason}
        onLogin={async (email, password) => {
          await auth.login(email, password);
          await afterAuth();
        }}
        onSignup={async (email, password) => {
          await auth.register(email, password);
          await afterAuth();
        }}
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
              showRepoPicker={api.engine === "live" && auth.isLoggedIn}
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
          <BubblesView api={api} />
        )}
      </div>
    </div>
  );
}
