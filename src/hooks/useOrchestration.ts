import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchHealth,
  startInstruct,
  startOrchestration,
  stopRun as stopRunApi,
  subscribeEvents,
  type LiveEvent,
  type TeamMemberPayload,
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
  ActivityEntry,
  AgentDef,
  AgentRuntime,
  AgentStatus,
  ChatMessage,
  ClarifyingQuestion,
  OrchMessage,
  PlannedTask,
  QuestionAnswer,
  ViewMode,
} from "../types";

export type EngineMode = "live" | "demo";

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
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [messages, setMessages] = useState<OrchMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [directing, setDirecting] = useState(false);
  const [view, setView] = useState<ViewMode>("reports");
  const [selected, setSelected] = useState<string | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());
  const [mapTick, setMapTick] = useState(0);
  const [engine, setEngine] = useState<EngineMode>("demo");
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
  const [currentGoal, setCurrentGoal] = useState<string | null>(null);
  const [plannedTasks, setPlannedTasks] = useState<PlannedTask[]>([]);

  const timersRef = useRef<number[]>([]);
  const castRef = useRef(cast);
  const agentStateRef = useRef(agentState);
  const chatsRef = useRef(chats);
  const viewRef = useRef(view);
  const selectedRef = useRef(selected);
  const runningRef = useRef(running);
  const directingRef = useRef(directing);
  const engineRef = useRef(engine);

  castRef.current = cast;
  agentStateRef.current = agentState;
  chatsRef.current = chats;
  viewRef.current = view;
  selectedRef.current = selected;
  runningRef.current = running;
  directingRef.current = directing;
  engineRef.current = engine;

  const teamPayload = useCallback((): TeamMemberPayload[] => {
    return castRef.current
      .filter((a) => !a.ephemeral)
      .map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
      }));
  }, []);

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
    (id: string, kind: ActivityEntry["kind"], text: string, status?: AgentStatus) => {
      const a = findAgent(id);
      setActivityLog((prev) => [
        ...prev,
        {
          t: Date.now(),
          id,
          name: a?.name || id,
          kind,
          status:
            status ||
            agentStateRef.current[id]?.status ||
            "idle",
          text: String(text || "").trim(),
        },
      ]);
    },
    [findAgent]
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

  const runScript = useCallback(
    (goal: string) => {
      clearTimers();
      const g = goal.trim() || DEFAULT_GOAL;
      setRunning(true);
      setCurrentGoal(g);
      setSuccessSummary(null);
      const demoPlan: PlannedTask[] = castRef.current
        .filter((a) => !a.hub && !a.ephemeral)
        .map((a) => ({
          id: a.id,
          task: `For “${g}”, contribute as ${a.name} (${a.role}).`,
          phase: "upcoming" as const,
        }));
      setPlannedTasks(demoPlan);
      logActivity("orchestrator", "instruct", g);
      setAgent("orchestrator", {
        status: "working",
        report: "Routing work to the team…",
      });

      const steps = buildScript(goal);
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
          if (step.type === "agent") {
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
          "Team wrapped the coffee landing plan. Ready for your review.";
        setAgent("orchestrator", {
          status: "done",
          report: brief,
        });
        setSuccessSummary(brief);
        setCelebrateOrch(true);
        play("success");
      });
    },
    [addMsg, clearTimers, later, logActivity, setAgent, showTyping]
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
        void startInstruct(
          { id: a.id, name: a.name, role: a.role },
          task,
          teamPayload()
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

  const stopRun = useCallback(() => {
    if (engineRef.current === "live") {
      void stopRunApi().catch((err: Error) => {
        setApiError(err.message);
        addMsg("orch", err.message);
        play("error");
      });
      return;
    }
    clearTimers();
    setRunning(false);
    setDirecting(false);
    setAgentState((s) => {
      const next = { ...s };
      for (const id of Object.keys(next)) {
        if (next[id].status === "working") {
          next[id] = {
            ...next[id],
            status: "idle",
            report: "Stopped by user.",
          };
        }
      }
      return next;
    });
    addMsg("orch", "Stopped demo run.");
    bumpMap();
  }, [addMsg, bumpMap, clearTimers]);

  const addAgent = useCallback(
    (name: string, role: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const ids = new Set(castRef.current.map((a) => a.id));
      const agent = makeCustomAgent(trimmed, role, ids);
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
      logActivity(agent.id, "system", `Joined the team as ${agent.role}.`);
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
      setActivityLog([]);
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
        void startOrchestration(DEFAULT_GOAL, teamPayload()).catch(
          (err: Error) => {
            setRunning(false);
            setApiError(err.message);
            addMsg("orch", err.message);
          }
        );
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
        void startOrchestration(t, teamPayload()).catch((err: Error) => {
          setApiError(err.message);
          addMsg("orch", err.message);
          play("error");
        });
        return;
      }
      if (runningRef.current) return;
      runScript(t);
    },
    [addMsg, ensureChatSeed, pushAgentChat, runScript, teamPayload]
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

  useEffect(() => {
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
        const a = castRef.current.find((x) => x.id === e.agentId);
        setActivityLog((prev) => [
          ...prev,
          {
            t: Date.now(),
            id: e.agentId,
            name: a?.name || e.agentId,
            kind: e.kind,
            status: e.status || agentStateRef.current[e.agentId]?.status || "idle",
            text: e.text,
          },
        ]);
        return;
      }
      if (e.type === "error") {
        setApiError(e.message);
        addMsg("orch", e.message);
        return;
      }
      if (e.type === "cancelled") {
        setRunning(false);
        setDirecting(false);
        if (e.message) addMsg("orch", e.message, "", { syncAgent: false });
        bumpMap();
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
                text: `Temporary helper for ${e.parentId}`,
              },
            ],
          }));
          setActivityLog((prev) => [
            ...prev,
            {
              t: Date.now(),
              id: e.id,
              name: e.name,
              kind: "system",
              status: "working",
              text: `Spawned under ${e.parentId}${e.task ? `: ${e.task}` : ""}`,
            },
          ]);
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
        setActivityLog((prev) => [
          ...prev,
          {
            t: Date.now(),
            id: e.id,
            name: e.name,
            kind: "system",
            status: e.action === "error" ? "blocked" : "done",
            text:
              e.action === "error"
                ? `Helper left with error: ${e.report || "failed"}`
                : "Helper finished — leaving the map.",
          },
        ]);
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
        }, 1400);
        return;
      }
      if (e.type === "goal") {
        setCurrentGoal(e.goal);
        setSuccessSummary(null);
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
        setPlannedTasks((prev) => {
          const exists = prev.some((p) => p.id === e.agentId);
          if (!exists && e.task) {
            return [
              ...prev,
              {
                id: e.agentId,
                task: e.task,
                phase:
                  e.phase === "done"
                    ? "done"
                    : e.phase === "active"
                      ? "active"
                      : "upcoming",
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
                e.phase === "done"
                  ? "done"
                  : e.phase === "active"
                    ? "active"
                    : p.phase,
            };
          });
        });
        return;
      }
    };

    return subscribeEvents(apply);
  }, [engine, addMsg, bumpMap]);

  return {
    cast,
    teamAgents,
    mapAgents,
    ephemeralAgents,
    agentState,
    chats,
    activityLog,
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
    apiError,
    awaitingIds,
    pendingQuestions,
    workProgress,
    currentGoal,
    plannedTasks,
    successSummary,
    celebrateOrch,
    DEFAULT_GOAL,
    ORCHESTRATOR,
    findAgent,
    instructAgent,
    answerQuestions,
    stopRun,
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
