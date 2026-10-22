import { useCallback, useEffect, useState } from "react";
import { ActiveTasks } from "./components/ActiveTasks";
import { ArtifactsPanel } from "./components/ArtifactsPanel";
import { AuthScreen } from "./components/AuthScreen";
import { Header } from "./components/Header";
import { JobsList } from "./components/JobsList";
import { ReportsView } from "./components/ReportsView";
import { BubblesView } from "./components/BubblesView";
import { fetchMe, logout, type AuthUser } from "./api/client";
import { useOrchestration } from "./hooks/useOrchestration";
import { useUiSounds } from "./hooks/useUiSounds";
import { play } from "./lib/sounds";
import { clearAccessToken, setAccessToken } from "./auth/session";

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchMe()
      .then((user) => {
        if (!cancelled) setAuthUser(user);
      })
      .catch(() => {
        if (!cancelled) {
          clearAccessToken();
          setAuthUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthed = useCallback((user: AuthUser, token: string) => {
    setAccessToken(token);
    setAuthUser(user);
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    setAuthUser(null);
  }, []);

  if (!authReady) {
    return (
      <div className="auth-screen">
        <p className="auth-loading">Loading…</p>
      </div>
    );
  }

  if (!authUser) {
    return <AuthScreen onAuthed={handleAuthed} />;
  }

  return <HiveShell user={authUser} onLogout={handleLogout} />;
}

function HiveShell({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => void;
}) {
  const api = useOrchestration(user.id);
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
        userEmail={user.email}
        onLogout={onLogout}
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
