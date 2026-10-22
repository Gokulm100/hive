import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  deleteJob as deleteJobApi,
  fetchArtifacts,
  fetchHealth,
  fetchJobs,
  fetchRepos,
  skipAgent as skipAgentApi,
  startInstruct,
  startOrchestration,
  stopJob as stopJobApi,
  stopRun as stopRunApi,
  subscribeEvents,
  type ListedRepo,
  type LiveEvent,
  type RunMode,
  type TeamMemberPayload,
  type WorkspacePayload,
} from "../api/client";
import { play } from "../lib/sounds";
import {
  DEFAULT_GOAL,
  ORCHESTRATOR,
  createInitialAgents,
  initialRuntime,
  makeCustomAgent,
  makeEphemeralAgent,
  redistributeAngles,
} from "../data/cast";
import { buildScript } from "../data/script";
import { uid } from "../lib/utils";
import type {
  AgentDef,
  AgentRuntime,
  AgentStatus,
  ChatMessage,
  ClarifyingQuestion,
  HiveArtifact,
  HiveJob,
  OrchMessage,
  PlannedTask,
  QuestionAnswer,
  ViewMode,
} from "../types";

export type EngineMode = "live" | "demo";

const DEMO_JOBS_KEY = "hive-demo-jobs";
const MAX_JOBS = 3;

function readDemoJobs(): HiveJob[] {
  try {
    const raw = localStorage.getItem(DEMO_JOBS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (j): j is HiveJob =>
        !!j &&
        typeof j === "object" &&
        typeof (j as HiveJob).id === "string" &&
        typeof (j as HiveJob).goal === "string"
    ).slice(0, MAX_JOBS);
  } catch {
    return [];
  }
}

function writeDemoJobs(list: HiveJob[]) {
  try {
    localStorage.setItem(DEMO_JOBS_KEY, JSON.stringify(list.slice(0, MAX_JOBS)));
  } catch {
    /* ignore */
  }
}

function trimJobsList(list: HiveJob[]): HiveJob[] {
  const next = [...list];
  while (next.length > MAX_JOBS) {
    let dropAt = -1;
    for (let i = next.length - 1; i >= 0; i -= 1) {
      if (next[i].status !== "running") {
        dropAt = i;
        break;
      }
    }
    if (dropAt < 0) dropAt = next.length - 1;
    next.splice(dropAt, 1);
  }
  return next;
}

function emptyChats(cast: AgentDef[]): Record<string, ChatMessage[]> {
  return Object.fromEntries(cast.map((a) => [a.id, [] as ChatMessage[]]));
}

function bootstrap() {
  const team = createInitialAgents();
  const cast = [ORCHESTRATOR, ...team];
  return {
    team,
    agentState: initialRuntime(cast),
    chats: emptyChats(cast),
  };
}

export function useOrchestration() {
  const [boot] = useState(bootstrap);
  const [teamAgents, setTeamAgents] = useState<AgentDef[]>(boot.team);
  const [ephemeralAgents, setEphemeralAgents] = useState<AgentDef[]>([]);
  const cast = useMemo(
    () => [ORCHESTRATOR, ...teamAgents, ...ephemeralAgents],
    [teamAgents, ephemeralAgents]
  );
  /** Permanent + temporary helpers for the bubble map */
  const mapAgents = useMemo(
    () => [...teamAgents, ...ephemeralAgents],
    [teamAgents, ephemeralAgents]
  );

  const [agentState, setAgentState] = useState<Record<string, AgentRuntime>>(
    boot.agentState
  );

  const [chats, setChats] = useState<Record<string, ChatMessage[]>>(boot.chats);
  const [messages, setMessages] = useState<OrchMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [directing, setDirecting] = useState(false);
  const [view, setView] = useState<ViewMode>("bubbles");
  const [selected, setSelected] = useState<string | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());
  const [mapTick, setMapTick] = useState(0);
  const [engine, setEngine] = useState<EngineMode>("demo");
  const [runMode, setRunMode] = useState<RunMode>("build");
  const [apiError, setApiError] = useState<string | null>(null);
  const [awaitingIds, setAwaitingIds] = useState<Set<string>>(() => new Set());
  const [pendingQuestions, setPendingQuestions] = useState<
    Record<string, ClarifyingQuestion[]>
  >({});
  /** Chat progress pulse — detail text stays in activity log only */
  const [workProgress, setWorkProgress] = useState<
    Record<string, { active: boolean; steps: number; label: string }>
  >({});
  const [successSummary, setSuccessSummary] = useState<string | null>(null);
  const [celebrateOrch, setCelebrateOrch] = useState(false);
  const [jobs, setJobs] = useState<HiveJob[]>(() => readDemoJobs());
  const [artifacts, setArtifacts] = useState<HiveArtifact[]>([]);
  const demoJobIdRef = useRef<string | null>(null);
  const [currentGoal, setCurrentGoal] = useState<string | null>(null);
  const [plannedTasks, setPlannedTasks] = useState<PlannedTask[]>([]);
  const [workspaceUrl, setWorkspaceUrl] = useState("");
  const [workspaceBranch, setWorkspaceBranch] = useState("");
  const [workspaceCustomUrl, setWorkspaceCustomUrl] = useState("");
  const [repos, setRepos] = useState<ListedRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [activeWorkspace, setActiveWorkspace] =
    useState<WorkspacePayload | null>(null);

  const timersRef = useRef<number[]>([]);
  const castRef = useRef(cast);
  const agentStateRef = useRef(agentState);
  const chatsRef = useRef(chats);
  const viewRef = useRef(view);
  const selectedRef = useRef(selected);
  const runningRef = useRef(running);
  const directingRef = useRef(directing);
  const engineRef = useRef(engine);
  const runModeRef = useRef(runMode);
  const demoSkippedRef = useRef<Set<string>>(new Set());

  castRef.current = cast;
  agentStateRef.current = agentState;
  chatsRef.current = chats;
  viewRef.current = view;
  selectedRef.current = selected;
  runningRef.current = running;
  directingRef.current = directing;
  engineRef.current = engine;
  runModeRef.current = runMode;

  const teamPayload = useCallback((): TeamMemberPayload[] => {
    return castRef.current
      .filter((a) => !a.ephemeral)
      .map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
      }));
  }, []);

  const workspacePayload = useCallback((): WorkspacePayload | null => {
    const raw =
      workspaceUrl === "__custom__"
        ? workspaceCustomUrl.trim()
        : workspaceUrl.trim();
    if (!raw) return null;
    return {
      url: raw,
      startingRef: workspaceBranch.trim() || undefined,
      autoCreatePR: true,
    };
  }, [workspaceUrl, workspaceCustomUrl, workspaceBranch]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const later = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  const findAgent = useCallback((id: string) => {
    return castRef.current.find((x) => x.id === id);
  }, []);

  const bumpMap = useCallback(() => setMapTick((t) => t + 1), []);

  const logActivity = useCallback(
    (_id: string, _kind: string, _text: string, _status?: AgentStatus) => {
      /* Detail log UI removed — keep hook for call-site compatibility */
    },
    []
  );

  const ensureChatSeed = useCallback(
    (id: string) => {
      setChats((prev) => {
        const existing = prev[id] ?? [];
        if (existing.length) return prev;
        const a = findAgent(id);
        if (!a) return prev;
        const report =
          agentStateRef.current[id]?.report || "Ready for instructions.";
        return {
          ...prev,
          [id]: [
            { role: "system", text: `Connected to ${a.name}` },
            { role: "agent", text: report },
          ],
        };
      });
    },
    [findAgent]
  );

  const pushAgentChat = useCallback(
    (
      id: string,
      role: ChatMessage["role"],
      text: string,
      opts: { typing?: boolean; replaceTyping?: boolean } = {}
    ) => {
      ensureChatSeed(id);
      setChats((prev) => {
        let list = [...(prev[id] ?? [])];
        if (!list.length) {
          const a = findAgent(id);
          const report =
            agentStateRef.current[id]?.report || "Ready for instructions.";
          if (a) {
            list = [
              { role: "system", text: `Connected to ${a.name}` },
              { role: "agent", text: report },
            ];
          }
        }
        if (opts.replaceTyping) {
          list = list.filter((m) => !m.typing);
        }
        list.push({ role, text, typing: !!opts.typing });
        return { ...prev, [id]: list };
      });
    },
    [ensureChatSeed, findAgent]
  );

  const setAgent = useCallback(
    (id: string, patch: Partial<AgentRuntime>) => {
      const prev = agentStateRef.current[id] || {
        status: "idle" as const,
        report: "",
        open: false,
      };
      const next = { ...prev, ...patch };
      setAgentState((s) => ({ ...s, [id]: next }));
      agentStateRef.current = {
        ...agentStateRef.current,
        [id]: next,
      };

      if (patch.status && patch.status !== prev.status) {
        logActivity(id, "status", `Status → ${patch.status}`, patch.status);
      }
      if (patch.report != null && patch.report !== prev.report) {
        logActivity(
          id,
          "report",
          patch.report,
          patch.status || prev.status
        );
      }

      bumpMap();

      if (patch.status === "done") {
        setFlashIds((f) => new Set(f).add(id));
        later(900, () => {
          setFlashIds((f) => {
            const n = new Set(f);
            n.delete(id);
            return n;
          });
          bumpMap();
        });
      }
    },
    [bumpMap, later, logActivity]
  );

  const addMsg = useCallback(
    (
      kind: OrchMessage["kind"],
      text: string,
      extraClass = "",
      opts: { syncAgent?: boolean } = {}
    ) => {
      const syncAgent = opts.syncAgent !== false;
      const msg: OrchMessage = {
        id: uid("msg"),
        kind,
        text,
        extraClass: extraClass || undefined,
      };
      setMessages((m) => {
        if (extraClass.includes("typing")) return [...m, msg];
        return [
          ...m.filter(
            (x) => !(x.kind === "orch" && x.extraClass?.includes("typing"))
          ),
          msg,
        ];
      });

      if (kind === "orch" && !extraClass.includes("typing") && syncAgent) {
        pushAgentChat("orchestrator", "agent", text, { replaceTyping: true });
        const prev = agentStateRef.current.orchestrator || {
          status: "idle" as const,
          report: "",
          open: false,
        };
        const nextStatus: AgentStatus = extraClass.includes("summary")
          ? "done"
          : "working";
        const next = { ...prev, report: text, status: nextStatus };
        setAgentState((s) => ({ ...s, orchestrator: next }));
        agentStateRef.current = {
          ...agentStateRef.current,
          orchestrator: next,
        };
        if (nextStatus !== prev.status) {
          logActivity(
            "orchestrator",
            "status",
            `Status → ${nextStatus}`,
            nextStatus
          );
        }
        if (text !== prev.report) {
          logActivity("orchestrator", "report", text, nextStatus);
        }
        bumpMap();
      } else if (kind === "orch" && !extraClass.includes("typing")) {
        pushAgentChat("orchestrator", "agent", text, { replaceTyping: true });
      }
      return msg;
    },
    [bumpMap, logActivity, pushAgentChat]
  );

  const showTyping = useCallback(() => {
    pushAgentChat("orchestrator", "agent", "Orchestrator is typing…", {
      typing: true,
    });
    return addMsg("orch", "Orchestrator is typing…", "typing");
  }, [addMsg, pushAgentChat]);

  const upsertDemoJobs = useCallback((updater: (prev: HiveJob[]) => HiveJob[]) => {
    setJobs((prev) => {
      const next = trimJobsList(updater(prev));
      writeDemoJobs(next);
      return next;
    });
  }, []);

  const runScript = useCallback(
    (goal: string) => {
      clearTimers();
      demoSkippedRef.current = new Set();
      const g = goal.trim() || DEFAULT_GOAL;
      const mode = runModeRef.current;
      const jobId = uid("job");
      demoJobIdRef.current = jobId;
      upsertDemoJobs((prev) => [
        {
          id: jobId,
          goal: g,
          mode,
          status: "running",
          startedAt: Date.now(),
        },
        ...prev.filter((j) => j.status !== "running"),
      ]);
      setRunning(true);
      setCurrentGoal(g);
      setSuccessSummary(null);
      const discuss = mode === "brainstorm" || mode === "casual";
      const leanIds = discuss ? new Set(["researcher", "bd"]) : null;
      const demoPlan: PlannedTask[] = castRef.current
        .filter((a) => !a.hub && !a.ephemeral)
        .filter((a) => !leanIds || leanIds.has(a.id))
        .map((a) => ({
          id: a.id,
          task: discuss
            ? mode === "casual"
              ? `Casual chat on “${g}” as ${a.name} (${a.role}).`
              : `Brainstorm “${g}” as ${a.name} (${a.role}).`
            : `For “${g}”, contribute as ${a.name} (${a.role}).`,
          phase: "upcoming" as const,
        }));
      setPlannedTasks(demoPlan);
      logActivity("orchestrator", "instruct", g);
      setAgent("orchestrator", {
        status: "working",
        report:
          mode === "casual"
            ? "Opening a casual chat…"
            : mode === "brainstorm"
              ? "Opening a lean brainstorm…"
              : "Routing work to the team…",
      });

      const steps = buildScript(goal, mode);
      let t = 0;

      steps.forEach((step) => {
        t += step.delay;
        later(t, () => {
          if (step.type === "orch" || step.type === "orch-summary") {
            showTyping();
            later(650, () => {
              setChats((prev) => {
                const chat = prev.orchestrator ?? [];
                return {
                  ...prev,
                  orchestrator: chat.filter((m) => !m.typing),
                };
              });
              addMsg(
                "orch",
                step.text,
                step.type === "orch-summary" ? "summary" : ""
              );
            });
            return;
          }
          if (step.type === "guest-spawn") {
            setEphemeralAgents((list) => {
              if (list.some((a) => a.id === step.id)) return list;
              const parent = castRef.current.find((a) => a.id === "orchestrator");
              return [
                ...list,
                makeEphemeralAgent(
                  step.id,
                  step.name,
                  step.role,
                  "orchestrator",
                  parent
                ),
              ];
            });
            setAgentState((s) => ({
              ...s,
              [step.id]: {
                status: "working",
                report: step.task,
                open: false,
              },
            }));
            setChats((c) => ({
              ...c,
              [step.id]: [
                {
                  role: "system",
                  text: "Brainstorm guest — pops in, then vanishes like smoke.",
                },
              ],
            }));
            if (viewRef.current === "bubbles") setSelected(step.id);
            bumpMap();
            play("add");
            return;
          }
          if (step.type === "guest-done") {
            setAgentState((s) => ({
              ...s,
              [step.id]: {
                ...(s[step.id] ?? { status: "idle", report: "", open: false }),
                status: "done",
                report: step.report?.slice(0, 160) || "Finished.",
              },
            }));
            setFlashIds((f) => new Set(f).add(step.id));
            bumpMap();
            later(1200, () => {
              setEphemeralAgents((list) => list.filter((a) => a.id !== step.id));
              setAgentState((s) => {
                const next = { ...s };
                delete next[step.id];
                return next;
              });
              setChats((c) => {
                const next = { ...c };
                delete next[step.id];
                return next;
              });
              setFlashIds((f) => {
                const n = new Set(f);
                n.delete(step.id);
                return n;
              });
              setSelected((sel) => (sel === step.id ? "orchestrator" : sel));
              bumpMap();
            });
            return;
          }
          if (step.type === "agent") {
            if (demoSkippedRef.current.has(step.id)) return;
            setAgent(step.id, {
              status: step.status,
              report:
                step.report ??
                agentStateRef.current[step.id]?.report ??
                "",
            });
            if (step.status === "working") {
              setPlannedTasks((prev) =>
                prev.map((p) =>
                  p.id === step.id
                    ? { ...p, phase: "active" }
                    : p.phase === "active"
                      ? { ...p, phase: "done" }
                      : p
                )
              );
            } else if (step.status === "done") {
              setPlannedTasks((prev) =>
                prev.map((p) =>
                  p.id === step.id ? { ...p, phase: "done" } : p
                )
              );
            }
          }
        });
      });

      later(t + 800, () => {
        setRunning(false);
        const brief =
          mode === "casual"
            ? "Casual chat wrapped — strongest direction noted. Nothing was built."
            : mode === "brainstorm"
              ? "Brainstorm wrapped — strongest direction noted. Nothing was built."
              : "Team wrapped the coffee landing plan. Ready for your review.";
        setAgent("orchestrator", {
          status: "done",
          report: brief,
        });
        setSuccessSummary(brief);
        setCelebrateOrch(true);
        const finishedId = demoJobIdRef.current;
        demoJobIdRef.current = null;
        if (finishedId) {
          upsertDemoJobs((prev) =>
            prev.map((j) =>
              j.id === finishedId
                ? {
                    ...j,
                    status: "done" as const,
                    summary: brief,
                    finishedAt: Date.now(),
                  }
                : j
            )
          );
        }
        play("success");
      });
    },
    [
      addMsg,
      bumpMap,
      clearTimers,
      later,
      logActivity,
      setAgent,
      showTyping,
      upsertDemoJobs,
    ]
  );

  const selectAgent = useCallback((id: string | null) => {
    if (id && !findAgent(id)) return;
    setSelected(id);
    if (id) ensureChatSeed(id);
    bumpMap();
  }, [bumpMap, ensureChatSeed, findAgent]);

  const instructAgent = useCallback(
    (id: string, instruction: string) => {
      const a = findAgent(id);
      if (!a || !instruction.trim()) return;
      const task = instruction.trim();

      if (engineRef.current === "live") {
        ensureChatSeed(id);
        pushAgentChat(id, "user", task);
        if (a.hub) addMsg("user", task);
        else addMsg("user", `→ ${a.name}: ${task}`);
        if (!runningRef.current) setRunning(true);
        setApiError(null);
        const ws = workspacePayload();
        setActiveWorkspace(ws);
        void startInstruct(
          { id: a.id, name: a.name, role: a.role },
          task,
          teamPayload(),
          ws,
          runModeRef.current
        ).catch((err: Error) => {
          setApiError(err.message);
          addMsg("orch", err.message);
        });
        return;
      }

      // Demo: don't stack scripts while one is running
      if (directingRef.current || runningRef.current) return;

      if (a.hub) {
        ensureChatSeed(id);
        pushAgentChat(id, "user", task);
        addMsg("user", task);
        setAgent("orchestrator", {
          status: "working",
          report: "Routing work to the team…",
        });
        runScript(task);
        return;
      }

      setDirecting(true);
      ensureChatSeed(id);
      pushAgentChat(id, "user", task);
      pushAgentChat(id, "agent", "On it…", { typing: true });
      addMsg("user", `→ ${a.name}: ${task}`);
      logActivity(id, "instruct", task);
      setAgent(id, {
        status: "working",
        report: `Received: “${task}”`,
      });

      later(1100, () => {
        const reply = `Done — “${task}”. Notes filed to Orchestrator.`;
        pushAgentChat(id, "agent", reply, { replaceTyping: true });
        setAgent(id, { status: "done", report: reply });
        showTyping();
        later(500, () => {
          addMsg(
            "orch",
            `${a.name} reported back on your direct instruction.`,
            "summary"
          );
          pushAgentChat(
            "orchestrator",
            "agent",
            `${a.name} reported: ${reply}`
          );
          setDirecting(false);
        });
      });
    },
    [
      addMsg,
      ensureChatSeed,
      findAgent,
      later,
      logActivity,
      pushAgentChat,
      runScript,
      setAgent,
      showTyping,
      teamPayload,
      workspacePayload,
    ]
  );

  const answerQuestions = useCallback(
    (id: string, answers: QuestionAnswer[], globalNote: string) => {
      const qs = pendingQuestions[id] ?? [];
      if (!qs.length || !answers.length) return;
      const body = [
        "My choices:",
        ...qs.map((q) => {
          const a = answers.find((x) => x.questionId === q.id);
          if (!a) return `• ${q.prompt}\n  → (skipped)`;
          const note = a.note?.trim() ? `\n  Note: ${a.note.trim()}` : "";
          return `• ${q.prompt}\n  → ${a.choiceLabel}${note}`;
        }),
        globalNote.trim() ? `\nAnything else:\n${globalNote.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      instructAgent(id, body);
    },
    [instructAgent, pendingQuestions]
  );

  /** Stop every agent still working on the current job in the UI. */
  const haltAllAgentsLocal = useCallback(
    (reason: string) => {
      setRunning(false);
      setDirecting(false);
      setAwaitingIds(new Set());
      setPendingQuestions({});
      setWorkProgress({});
      setPlannedTasks((tasks) =>
        tasks.map((t) =>
          t.phase === "active" || t.phase === "upcoming"
            ? { ...t, phase: "skipped" as const }
            : t
        )
      );

      const ephemeralIds = new Set(
        castRef.current.filter((a) => a.ephemeral).map((a) => a.id)
      );

      setAgentState((s) => {
        const next = { ...s };
        for (const id of Object.keys(next)) {
          const cur = next[id];
          if (ephemeralIds.has(id)) {
            next[id] = { ...cur, status: "done", report: reason };
            continue;
          }
          if (cur.status === "working" || cur.status === "blocked") {
            next[id] = { ...cur, status: "idle", report: reason };
          }
        }
        return next;
      });

      if (ephemeralIds.size) {
        const ids = [...ephemeralIds];
        window.setTimeout(() => {
          setEphemeralAgents((prev) =>
            prev.filter((a) => !ids.includes(a.id))
          );
          setAgentState((s) => {
            const n = { ...s };
            for (const id of ids) delete n[id];
            return n;
          });
          bumpMap();
        }, 500);
      }

      bumpMap();
    },
    [bumpMap]
  );

  const stopRun = useCallback(() => {
    if (engineRef.current === "live") {
      haltAllAgentsLocal("Stopped with this job.");
      void stopRunApi().catch((err: Error) => {
        setApiError(err.message);
        addMsg("orch", err.message);
        play("error");
      });
      return;
    }
    clearTimers();
    haltAllAgentsLocal("Stopped by user.");
    const stoppedId = demoJobIdRef.current;
    demoJobIdRef.current = null;
    if (stoppedId) {
      upsertDemoJobs((prev) =>
        prev.map((j) =>
          j.id === stoppedId
            ? {
                ...j,
                status: "cancelled" as const,
                summary: "Stopped by you.",
                finishedAt: Date.now(),
              }
            : j
        )
      );
    }
    addMsg("orch", "Stopped demo run — all agents halted.");
  }, [addMsg, clearTimers, haltAllAgentsLocal, upsertDemoJobs]);

  const stopJob = useCallback(
    (jobId: string) => {
      const id = jobId.trim();
      if (!id) return;
      const job = jobs.find((j) => j.id === id);
      if (!job || job.status !== "running") return;

      if (engineRef.current === "live") {
        haltAllAgentsLocal("Stopped with this job.");
        void stopJobApi(id).catch((err: Error) => {
          setApiError(err.message);
          addMsg("orch", err.message);
          play("error");
        });
        return;
      }

      if (demoJobIdRef.current === id) {
        stopRun();
        return;
      }
      upsertDemoJobs((prev) =>
        prev.map((j) =>
          j.id === id
            ? {
                ...j,
                status: "cancelled" as const,
                summary: "Stopped by you.",
                finishedAt: Date.now(),
              }
            : j
        )
      );
    },
    [addMsg, haltAllAgentsLocal, jobs, stopRun, upsertDemoJobs]
  );

  const deleteJob = useCallback(
    (jobId: string) => {
      const id = jobId.trim();
      if (!id) return;

      if (engineRef.current === "live") {
        const wasRunning =
          running || jobs.some((j) => j.id === id && j.status === "running");
        if (wasRunning) haltAllAgentsLocal("Job deleted — all agents stopped.");
        void deleteJobApi(id)
          .then(() => {
            setJobs((prev) => prev.filter((j) => j.id !== id));
          })
          .catch((err: Error) => {
            setApiError(err.message);
            addMsg("orch", err.message);
            play("error");
          });
        return;
      }

      const wasActiveDemo = demoJobIdRef.current === id;
      if (wasActiveDemo) {
        clearTimers();
        demoJobIdRef.current = null;
        haltAllAgentsLocal("Job deleted.");
      }
      upsertDemoJobs((prev) => prev.filter((j) => j.id !== id));
      if (wasActiveDemo) addMsg("orch", "Deleted demo job — all agents halted.");
    },
    [
      addMsg,
      clearTimers,
      haltAllAgentsLocal,
      jobs,
      running,
      upsertDemoJobs,
    ]
  );

  const skipAgent = useCallback(
    (agentId: string) => {
      const id = agentId.trim();
      if (!id || id === "orchestrator") return;
      const agent = castRef.current.find((a) => a.id === id);
      const name = agent?.name || id;

      if (engineRef.current === "live") {
        void skipAgentApi(id).catch((err: Error) => {
          setApiError(err.message);
          addMsg("orch", err.message);
          play("error");
        });
        return;
      }

      demoSkippedRef.current.add(id);
      setPlannedTasks((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, phase: "skipped" as const } : p
        )
      );
      setAgentState((s) => ({
        ...s,
        [id]: {
          ...(s[id] ?? { status: "idle", report: "", open: false }),
          status: "idle",
          report: "Skipped.",
        },
      }));
      setAwaitingIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setPendingQuestions((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      addMsg("orch", `Skipped ${name}.`);
      bumpMap();
    },
    [addMsg, bumpMap]
  );

  const addAgent = useCallback(
    (name: string, skills: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const ids = new Set(castRef.current.map((a) => a.id));
      const agent = makeCustomAgent(
        trimmed,
        skills.trim() || "Custom agent",
        ids
      );
      setTeamAgents((list) => {
        const next = [...list, agent];
        redistributeAngles(next);
        return next;
      });
      setAgentState((s) => ({
        ...s,
        [agent.id]: {
          status: "idle",
          report: "New hire — ready for assignment.",
          open: false,
        },
      }));
      setChats((c) => ({ ...c, [agent.id]: [] }));
      logActivity(
        agent.id,
        "system",
        skills.trim()
          ? `Joined with custom skills (${skills.trim().slice(0, 80)}${skills.trim().length > 80 ? "…" : ""}).`
          : `Joined the team as ${agent.role}.`
      );
      play("add");
      if (viewRef.current === "bubbles") setSelected(agent.id);
      bumpMap();
      return agent;
    },
    [bumpMap, logActivity]
  );

  const removeAgent = useCallback(
    (id: string) => {
      const a = findAgent(id);
      if (!a || a.hub || !a.custom) return;
      logActivity(id, "system", "Removed from the team.");
      setTeamAgents((list) => {
        const next = list.filter((x) => x.id !== id);
        redistributeAngles(next);
        return next;
      });
      setAgentState((s) => {
        const n = { ...s };
        delete n[id];
        return n;
      });
      setChats((c) => {
        const n = { ...c };
        delete n[id];
        return n;
      });
      if (selectedRef.current === id) setSelected(null);
      bumpMap();
    },
    [bumpMap, findAgent, logActivity]
  );

  const resetAll = useCallback(
    (keepEmpty = true) => {
      clearTimers();
      setRunning(false);
      setDirecting(false);
      setSelected(null);
      setFlashIds(new Set());
      setMessages([]);
      setSuccessSummary(null);
      setCelebrateOrch(false);
      setCurrentGoal(null);
      setPlannedTasks([]);
      setAwaitingIds(new Set());
      setPendingQuestions({});
      setWorkProgress({});
      setAgentState(() => {
        const next: Record<string, AgentRuntime> = {};
        castRef.current.forEach((a) => {
          next[a.id] = {
            status: "idle",
            report: a.hub
              ? "Ready to route work across the team."
              : a.custom
                ? "New hire — ready for assignment."
                : "Waiting for assignment.",
            open: false,
          };
        });
        return next;
      });
      setEphemeralAgents([]);
      setChats(() => emptyChats([ORCHESTRATOR, ...teamAgents]));
      bumpMap();
      void keepEmpty;
    },
    [bumpMap, clearTimers, teamAgents]
  );

  const startReplay = useCallback(() => {
    if (runningRef.current) return;
    resetAll(false);
    if (viewRef.current === "bubbles") setSelected("orchestrator");
    ensureChatSeed("orchestrator");
    pushAgentChat("orchestrator", "user", DEFAULT_GOAL);
    addMsg("user", DEFAULT_GOAL);
    later(0, () => {
      if (engineRef.current === "live") {
        setRunning(true);
        setApiError(null);
        const ws = workspacePayload();
        setActiveWorkspace(ws);
        void startOrchestration(
          DEFAULT_GOAL,
          teamPayload(),
          ws,
          runModeRef.current
        ).catch((err: Error) => {
          setRunning(false);
          setApiError(err.message);
          addMsg("orch", err.message);
        });
      } else {
        runScript(DEFAULT_GOAL);
      }
    });
  }, [
    addMsg,
    ensureChatSeed,
    later,
    pushAgentChat,
    resetAll,
    runScript,
    teamPayload,
    workspacePayload,
  ]);

  const submitGoal = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      ensureChatSeed("orchestrator");
      pushAgentChat("orchestrator", "user", t);
      addMsg("user", t);
      setCurrentGoal(t);
      setPlannedTasks([]);
      setSuccessSummary(null);
      if (engineRef.current === "live") {
        if (!runningRef.current) setRunning(true);
        setApiError(null);
        const ws = workspacePayload();
        setActiveWorkspace(ws);
        void startOrchestration(
          t,
          teamPayload(),
          ws,
          runModeRef.current
        ).catch((err: Error) => {
          setApiError(err.message);
          addMsg("orch", err.message);
          play("error");
        });
        return;
      }
      if (runningRef.current) return;
      runScript(t);
    },
    [
      addMsg,
      ensureChatSeed,
      pushAgentChat,
      runScript,
      teamPayload,
      workspacePayload,
    ]
  );

  const toggleCard = useCallback((id: string) => {
    setAgentState((s) => ({
      ...s,
      [id]: { ...s[id], open: !s[id]?.open },
    }));
  }, []);

  const persistBubblePos = useCallback(
    (id: string, x: number, y: number, w: number, h: number) => {
      if (!w || !h) return;
      if (id === "orchestrator") {
        ORCHESTRATOR.nx = x / w;
        ORCHESTRATOR.ny = y / h;
        return;
      }
      setTeamAgents((list) =>
        list.map((a) =>
          a.id === id ? { ...a, nx: x / w, ny: y / h } : a
        )
      );
    },
    []
  );

  // Before paint so BubbleMap doesn't measure a display:none canvas
  useLayoutEffect(() => {
    document.body.classList.toggle("view-reports", view === "reports");
    document.body.classList.toggle("view-bubbles", view === "bubbles");
  }, [view]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    let cancelled = false;
    fetchHealth()
      .then((h) => {
        if (cancelled) return;
        if (h.cursor) {
          setEngine("live");
          setApiError(null);
        } else {
          setEngine("demo");
          setApiError("No CURSOR_API_KEY on server — running demo script.");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setEngine("demo");
        setApiError("API offline — demo mode. Run npm run dev (client+server).");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (engine !== "live") {
      setRepos([]);
      setJobs(readDemoJobs());
      setArtifacts([]);
      return;
    }
    let cancelled = false;
    setReposLoading(true);
    fetchRepos()
      .then((list) => {
        if (!cancelled) setRepos(list);
      })
      .catch(() => {
        if (!cancelled) setRepos([]);
      })
      .finally(() => {
        if (!cancelled) setReposLoading(false);
      });
    fetchJobs()
      .then((list) => {
        if (!cancelled) setJobs(list);
      })
      .catch(() => {
        /* SSE snapshot will fill in */
      });
    fetchArtifacts()
      .then((list) => {
        if (!cancelled) setArtifacts(list);
      })
      .catch(() => {
        /* SSE snapshot will fill in */
      });
    return () => {
      cancelled = true;
    };
  }, [engine]);

  useEffect(() => {
    if (engine !== "live") return;

    const apply = (e: LiveEvent) => {
      if (e.type === "run") {
        setRunning(e.running);
        if (!e.running) setDirecting(false);
        return;
      }
      if (e.type === "status") {
        setAgentState((s) => ({
          ...s,
          [e.agentId]: {
            ...(s[e.agentId] ?? {
              status: "idle",
              report: "",
              open: false,
            }),
            status: e.status,
            report: e.report ?? s[e.agentId]?.report ?? "",
          },
        }));
        setWorkProgress((prev) => {
          if (e.status === "working") {
            const already = prev[e.agentId]?.active;
            return {
              ...prev,
              [e.agentId]: {
                active: true,
                steps: already ? prev[e.agentId].steps : 0,
                label: e.report?.trim() || "Working…",
              },
            };
          }
          const next = { ...prev };
          delete next[e.agentId];
          return next;
        });
        if (e.status === "done") {
          setFlashIds((f) => new Set(f).add(e.agentId));
          window.setTimeout(() => {
            setFlashIds((f) => {
              const n = new Set(f);
              n.delete(e.agentId);
              return n;
            });
            bumpMap();
          }, 900);
        }
        bumpMap();
        return;
      }
      if (e.type === "chat") {
        setChats((prev) => {
          const list = [...(prev[e.agentId] ?? [])];
          if (!list.length) {
            const a = castRef.current.find((x) => x.id === e.agentId);
            if (a) {
              list.push(
                { role: "system", text: `Connected to ${a.name}` },
                {
                  role: "agent",
                  text:
                    agentStateRef.current[e.agentId]?.report ||
                    "Ready for instructions.",
                }
              );
            }
          }
          list.push({ role: e.role, text: e.text });
          return { ...prev, [e.agentId]: list };
        });
        return;
      }
      if (e.type === "orch") {
        if (e.kind === "typing") {
          addMsg("orch", e.text, "typing", { syncAgent: false });
        } else {
          addMsg("orch", e.text, e.kind === "summary" ? "summary" : "", {
            syncAgent: false,
          });
        }
        return;
      }
      if (e.type === "log") {
        return;
      }
      if (e.type === "error") {
        setApiError(e.message);
        addMsg("orch", e.message);
        return;
      }
      if (e.type === "cancelled") {
        haltAllAgentsLocal(
          e.message?.trim() || "Stopped — all agents on this job halted."
        );
        if (e.message) addMsg("orch", e.message, "", { syncAgent: false });
        return;
      }
      if (e.type === "queued") {
        return;
      }
      if (e.type === "success") {
        setSuccessSummary(e.summary);
        setCelebrateOrch(true);
        play("success");
        setAgentState((s) => ({
          ...s,
          orchestrator: {
            ...(s.orchestrator ?? {
              status: "idle",
              report: "",
              open: false,
            }),
            status: "done",
            report: e.summary,
          },
        }));
        bumpMap();
        return;
      }
      if (e.type === "process") {
        // Progress only in chat UI; full text already lands in detail log via "log"
        setWorkProgress((prev) => {
          const cur = prev[e.agentId];
          return {
            ...prev,
            [e.agentId]: {
              active: true,
              steps: (cur?.steps ?? 0) + 1,
              label: e.text,
            },
          };
        });
        return;
      }
      if (e.type === "awaiting") {
        setAwaitingIds((prev) => {
          const n = new Set(prev);
          if (e.waiting) n.add(e.agentId);
          else n.delete(e.agentId);
          return n;
        });
        setPendingQuestions((prev) => {
          if (!e.waiting) {
            const next = { ...prev };
            delete next[e.agentId];
            return next;
          }
          if (e.questions?.length) {
            return { ...prev, [e.agentId]: e.questions };
          }
          return prev;
        });
        if (e.waiting) {
          play("wait");
          setSelected(e.agentId);
          setAgentState((s) => ({
            ...s,
            [e.agentId]: {
              ...(s[e.agentId] ?? {
                status: "idle",
                report: "",
                open: false,
              }),
              status: "blocked",
              report: "Waiting for your answers before starting.",
            },
          }));
          bumpMap();
        }
        return;
      }
      if (e.type === "subagent") {
        if (e.action === "spawn") {
          setEphemeralAgents((list) => {
            if (list.some((a) => a.id === e.id)) return list;
            const parent = castRef.current.find((a) => a.id === e.parentId);
            const agent = makeEphemeralAgent(
              e.id,
              e.name,
              e.role,
              e.parentId,
              parent
            );
            return [...list, agent];
          });
          setAgentState((s) => ({
            ...s,
            [e.id]: {
              status: "working",
              report: e.task || "Helping…",
              open: false,
            },
          }));
          setChats((c) => ({
            ...c,
            [e.id]: [
              {
                role: "system",
                text: `Guest bubble for ${e.parentId} — vanishes when done.`,
              },
            ],
          }));
          play("add");
          if (viewRef.current === "bubbles") setSelected(e.id);
          bumpMap();
          return;
        }

        // done | error — flash, then leave the map
        setAgentState((s) => ({
          ...s,
          [e.id]: {
            ...(s[e.id] ?? { status: "idle", report: "", open: false }),
            status: e.action === "error" ? "blocked" : "done",
            report: e.report?.slice(0, 160) || (e.action === "error" ? "Failed" : "Finished."),
          },
        }));
        setFlashIds((f) => new Set(f).add(e.id));
        bumpMap();
        window.setTimeout(() => {
          setEphemeralAgents((list) => list.filter((a) => a.id !== e.id));
          setAgentState((s) => {
            const next = { ...s };
            delete next[e.id];
            return next;
          });
          setChats((c) => {
            const next = { ...c };
            delete next[e.id];
            return next;
          });
          setWorkProgress((p) => {
            const next = { ...p };
            delete next[e.id];
            return next;
          });
          setFlashIds((f) => {
            const n = new Set(f);
            n.delete(e.id);
            return n;
          });
          setSelected((sel) => (sel === e.id ? e.parentId : sel));
          bumpMap();
        }, 1200);
        return;
      }
      if (e.type === "jobs") {
        setJobs(e.jobs);
        return;
      }
      if (e.type === "artifacts") {
        setArtifacts(e.artifacts);
        return;
      }
      if (e.type === "artifact") {
        if (e.action === "deleted") {
          setArtifacts((prev) => prev.filter((a) => a.id !== e.artifact.id));
          return;
        }
        setArtifacts((prev) => {
          if (prev.some((a) => a.id === e.artifact.id)) {
            return prev.map((a) =>
              a.id === e.artifact.id ? e.artifact : a
            );
          }
          return [e.artifact, ...prev];
        });
        return;
      }
      if (e.type === "goal") {
        setCurrentGoal(e.goal);
        setSuccessSummary(null);
        if (
          e.mode === "brainstorm" ||
          e.mode === "build" ||
          e.mode === "casual" ||
          e.mode === "fast"
        ) {
          setRunMode(e.mode);
        }
        setActiveWorkspace(
          e.workspace?.url
            ? {
                url: e.workspace.url,
                startingRef: e.workspace.startingRef,
              }
            : null
        );
        return;
      }
      if (e.type === "plan") {
        setCurrentGoal(e.goal);
        setPlannedTasks(
          e.assignments.map((a) => ({
            id: a.id,
            task: a.task,
            phase: "upcoming" as const,
          }))
        );
        return;
      }
      if (e.type === "task") {
        const phase =
          e.phase === "done"
            ? ("done" as const)
            : e.phase === "active"
              ? ("active" as const)
              : e.phase === "skipped"
                ? ("skipped" as const)
                : ("upcoming" as const);
        if (e.phase === "skipped") {
          setAgentState((s) => ({
            ...s,
            [e.agentId]: {
              ...(s[e.agentId] ?? {
                status: "idle",
                report: "",
                open: false,
              }),
              status: "idle",
              report: "Skipped.",
            },
          }));
          setAwaitingIds((prev) => {
            if (!prev.has(e.agentId)) return prev;
            const next = new Set(prev);
            next.delete(e.agentId);
            return next;
          });
          setWorkProgress((p) => {
            if (!(e.agentId in p)) return p;
            const next = { ...p };
            delete next[e.agentId];
            return next;
          });
          bumpMap();
        }
        setPlannedTasks((prev) => {
          const exists = prev.some((p) => p.id === e.agentId);
          if (!exists && (e.task || e.phase === "skipped")) {
            return [
              ...prev,
              {
                id: e.agentId,
                task: e.task || "Skipped",
                phase,
              },
            ];
          }
          return prev.map((p) => {
            if (p.id !== e.agentId) {
              if (e.phase === "active" && p.phase === "active") {
                return { ...p, phase: "done" as const };
              }
              return p;
            }
            return {
              ...p,
              task: e.task ?? p.task,
              phase:
                e.phase === "done" ||
                e.phase === "active" ||
                e.phase === "skipped"
                  ? phase
                  : p.phase,
            };
          });
        });
        return;
      }
    };

    return subscribeEvents(apply);
  }, [engine, addMsg, bumpMap, haltAllAgentsLocal]);

  return {
    cast,
    teamAgents,
    mapAgents,
    ephemeralAgents,
    agentState,
    chats,
    messages,
    running,
    directing,
    view,
    setView,
    selected,
    selectAgent,
    flashIds,
    mapTick,
    engine,
    setEngine,
    runMode,
    setRunMode,
    apiError,
    awaitingIds,
    pendingQuestions,
    workProgress,
    currentGoal,
    plannedTasks,
    jobs,
    artifacts,
    removeArtifact: (id: string) =>
      setArtifacts((prev) => prev.filter((a) => a.id !== id)),
    activeWorkspace,
    workspaceUrl,
    setWorkspaceUrl,
    workspaceBranch,
    setWorkspaceBranch,
    workspaceCustomUrl,
    setWorkspaceCustomUrl,
    repos,
    reposLoading,
    successSummary,
    celebrateOrch,
    DEFAULT_GOAL,
    ORCHESTRATOR,
    findAgent,
    instructAgent,
    answerQuestions,
    stopRun,
    stopJob,
    deleteJob,
    skipAgent,
    addAgent,
    removeAgent,
    resetAll,
    startReplay,
    submitGoal,
    toggleCard,
    persistBubblePos,
    ensureChatSeed,
  };
}

export type OrchestrationApi = ReturnType<typeof useOrchestration>;
