import { useEffect, useRef, useState } from "react";
import type { ListedRepo } from "../api/client";
import { charHtml } from "../data/chars";
import { ORCHESTRATOR } from "../data/cast";
import { polarToXY } from "../lib/utils";
import { bubbleFillPctForId } from "../lib/bubbleFill";
import type { AgentDef, AgentRuntime, PlannedTask } from "../types";

type WorkProgress = { active: boolean; steps: number; label: string };
import { AddAgentModal } from "./AddAgentModal";
import { RepoPicker } from "./RepoPicker";
import { StoryPicker } from "./StoryPicker";

function connectorClass(status: string, ephemeral = false) {
  const parts = ["connector"];
  if (ephemeral) parts.push("ephemeral");
  // Dashed flow only for the agent currently working
  if (status === "working") parts.push("active");
  else if (status === "done" || status === "blocked") parts.push(status);
  return parts.join(" ");
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
  onPersistPos: (id: string, x: number, y: number, w: number, h: number) => void;
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
  /** Fill / start a goal from a Jira story */
  onApplyStoryGoal?: (goal: string) => void;
  workProgress?: Record<string, WorkProgress>;
  plannedTasks?: PlannedTask[];
  running?: boolean;
};

const STRESS_FX = `<span class="stress-fx" aria-hidden="true">
  <i class="steam s1"></i><i class="steam s2"></i><i class="steam s3"></i>
  <i class="sweat d1"></i><i class="sweat d2"></i><i class="sweat d3"></i>
</span>`;

const SLEEP_FX = `<span class="sleep-fx" aria-hidden="true">
  <span class="zzz z1">z</span><span class="zzz z2">z</span><span class="zzz z3">z</span><span class="zzz z4">z</span>
</span>`;

/** Stable per-agent offset so idle zzz cycles feel random across the bubble map. */
function sleepPhaseSec(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  const u = (h >>> 0) % 10_000;
  return (u / 1000) * 0.85 + 0.15;
}

type HeatPhase = "none" | "fuming" | "cooling";

/** Working > 3 min → red-hot fume 10s → slow cooldown back to normal. */
const WORK_BEFORE_FUME_MS = 3 * 60 * 1000;
const FUME_HOLD_MS = 10 * 1000;
const COOLDOWN_MS = 8 * 1000;

function bubbleClassNames(
  id: string,
  isHub: boolean,
  status: string,
  selected: string | null,
  flashIds: Set<string>,
  heatPhase: HeatPhase,
  celebrate: boolean,
  ephemeral = false
) {
  const sel = selected === id ? "selected" : "";
  const glow =
    selected === id || status === "working" || celebrate ? "glow" : "";
  const flash = flashIds.has(id) ? "flash" : "";
  const heat =
    heatPhase === "fuming"
      ? "overheating"
      : heatPhase === "cooling"
        ? "cooling"
        : "";
  const cheer = celebrate ? "celebrate" : "";
  const sub = ephemeral ? "ephemeral" : "";
  return `agent-bubble ${isHub ? "hub" : ""} ${status} ${flash} ${sel} ${glow} ${heat} ${cheer} ${sub}`
    .replace(/\s+/g, " ")
    .trim();
}

function syncDropletFill(
  droplet: HTMLElement | null,
  pct: number
) {
  if (!droplet) return;
  const clamped = Math.max(0, Math.min(100, pct));
  droplet.style.setProperty("--fill-pct", `${clamped}%`);
}

function heatChipLabel(status: string, phase: HeatPhase, ephemeral: boolean) {
  if (ephemeral) return status === "done" ? "done" : "helper";
  if (phase === "fuming" && status === "working") return "fuming…";
  if (phase === "cooling" && status === "working") return "cooling…";
  return status;
}

export function BubbleMap({
  addAgentToken,
  teamAgents,
  agentState,
  selected,
  flashIds,
  mapTick,
  celebrateOrch,
  onSelect,
  onPersistPos,
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
  workProgress = {},
  plannedTasks = [],
  running = false,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected);
  const agentStateRef = useRef(agentState);
  const teamRef = useRef(teamAgents);
  const flashRef = useRef(flashIds);
  const celebrateRef = useRef(celebrateOrch);
  /** id → heat cycle phase */
  const heatPhaseRef = useRef(new Map<string, { phase: HeatPhase; since: number }>());
  /** When this working stretch started (reset after a full cool-down). */
  const workSinceRef = useRef(new Map<string, number>());
  const onSelectRef = useRef(onSelect);
  const onPersistRef = useRef(onPersistPos);
  const workProgressRef = useRef(workProgress);
  const plannedTasksRef = useRef(plannedTasks);
  const runningRef = useRef(running);

  selectedRef.current = selected;
  agentStateRef.current = agentState;
  teamRef.current = teamAgents;
  flashRef.current = flashIds;
  celebrateRef.current = celebrateOrch;
  onSelectRef.current = onSelect;
  onPersistRef.current = onPersistPos;
  workProgressRef.current = workProgress;
  plannedTasksRef.current = plannedTasks;
  runningRef.current = running;

  const [addOpen, setAddOpen] = useState(false);
  const [, setHeatTick] = useState(0);
  const layoutKeyRef = useRef("");

  useEffect(() => {
    if (addAgentToken && addAgentToken > 0) setAddOpen(true);
  }, [addAgentToken]);

  function heatPhaseOf(id: string): HeatPhase {
    return heatPhaseRef.current.get(id)?.phase ?? "none";
  }

  function fillPctFor(id: string, ephemeral = false) {
    return bubbleFillPctForId(id, {
      agentState: agentStateRef.current,
      plannedTasks: plannedTasksRef.current,
      workProgress: workProgressRef.current,
      running: runningRef.current,
      celebrateOrch: celebrateRef.current,
      ephemeral,
    });
  }

  function applyHeatClassesToDom() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.querySelectorAll<HTMLElement>(".agent-bubble[data-id]").forEach((node) => {
      const id = node.dataset.id!;
      const phase = heatPhaseOf(id);
      node.classList.toggle("overheating", phase === "fuming");
      node.classList.toggle("cooling", phase === "cooling");
      const status = agentStateRef.current[id]?.status || "idle";
      const ephemeral = !!teamRef.current.find((a) => a.id === id)?.ephemeral;
      const chip = node.querySelector(".mini-chip");
        if (chip && id !== "orchestrator") {
        chip.textContent = heatChipLabel(status, phase, ephemeral);
      }
      syncDropletFill(
        node.querySelector<HTMLElement>(".droplet"),
        fillPctFor(id, ephemeral)
      );
    });
  }

  // Working > 3 min → fume 10s → cooldown → reset timer
  useEffect(() => {
    const now = Date.now();
    const workSince = workSinceRef.current;
    const phases = heatPhaseRef.current;
    for (const [id, runtime] of Object.entries(agentState)) {
      if (runtime.status === "working") {
        if (!workSince.has(id)) workSince.set(id, now);
      } else {
        workSince.delete(id);
        phases.delete(id);
      }
    }
    for (const id of [...phases.keys()]) {
      if (agentStateRef.current[id]?.status !== "working") phases.delete(id);
    }

    const tick = window.setInterval(() => {
      const t = Date.now();
      let changed = false;
      for (const [id, started] of workSinceRef.current) {
        if (agentStateRef.current[id]?.status !== "working") continue;
        let entry = heatPhaseRef.current.get(id);
        if (!entry || entry.phase === "none") {
          if (t - started >= WORK_BEFORE_FUME_MS) {
            heatPhaseRef.current.set(id, { phase: "fuming", since: t });
            changed = true;
          }
          continue;
        }
        if (entry.phase === "fuming" && t - entry.since >= FUME_HOLD_MS) {
          heatPhaseRef.current.set(id, { phase: "cooling", since: t });
          changed = true;
          continue;
        }
        if (entry.phase === "cooling" && t - entry.since >= COOLDOWN_MS) {
          heatPhaseRef.current.delete(id);
          // Fresh stretch — another 3 min of work before the next fume
          workSinceRef.current.set(id, t);
          changed = true;
        }
      }
      if (changed) setHeatTick((n) => n + 1);
      applyHeatClassesToDom();
    }, 500);
    return () => clearInterval(tick);
  }, [agentState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    function mapLayoutKey(w: number, h: number) {
      return `${Math.round(w)}x${Math.round(h)}x${teamRef.current.map((a) => a.id).join(",")}`;
    }

    function updateMapBubbleStates() {
      const svg = canvas!.querySelector("svg");
      canvas!.querySelectorAll<HTMLElement>(".agent-bubble[data-id]").forEach((node) => {
        const id = node.dataset.id!;
        const isHub = id === "orchestrator";
        const status = agentStateRef.current[id]?.status || "idle";
        const keepZoom = node.classList.contains("zoom-play");
        const ephemeral = !!teamRef.current.find((a) => a.id === id)?.ephemeral;
        const phase = heatPhaseOf(id);
        node.className = bubbleClassNames(
          id,
          isHub,
          status,
          selectedRef.current,
          flashRef.current,
          phase,
          isHub && celebrateRef.current,
          ephemeral
        );
        if (keepZoom) node.classList.add("zoom-play");
        const chip = node.querySelector(".mini-chip");
        if (chip) {
          chip.textContent =
            isHub && celebrateRef.current
              ? "success"
              : heatChipLabel(status, phase, ephemeral);
        }
        if (svg) {
          const line = svg.querySelector(`line.connector[data-to="${id}"]`);
          if (line) {
            const agent = teamRef.current.find((a) => a.id === id);
            line.setAttribute(
              "class",
              connectorClass(status, !!agent?.ephemeral)
            );
          }
        }
        syncDropletFill(
          node.querySelector<HTMLElement>(".droplet"),
          fillPctFor(id, ephemeral)
        );
      });
    }

    function anchorFor(agent: AgentDef, hubX: number, hubY: number) {
      if (agent.ephemeral && agent.parentId) {
        const parentBtn = canvas!.querySelector<HTMLElement>(
          `.agent-bubble[data-id="${agent.parentId}"]`
        );
        if (parentBtn) {
          return {
            x: parseFloat(parentBtn.style.left) || hubX,
            y: parseFloat(parentBtn.style.top) || hubY,
          };
        }
      }
      return { x: hubX, y: hubY };
    }

    function syncConnectors() {
      const svg = canvas!.querySelector("svg");
      const hubBtn = canvas!.querySelector<HTMLElement>(
        '.agent-bubble[data-id="orchestrator"]'
      );
      if (!svg || !hubBtn) return;
      const hx = parseFloat(hubBtn.style.left) || 0;
      const hy = parseFloat(hubBtn.style.top) || 0;
      teamRef.current.forEach((a) => {
        const btn = canvas!.querySelector<HTMLElement>(
          `.agent-bubble[data-id="${a.id}"]`
        );
        const line = svg.querySelector(
          `line.connector[data-to="${a.id}"]`
        ) as SVGLineElement | null;
        if (!btn || !line) return;
        const x2 = parseFloat(btn.style.left) || 0;
        const y2 = parseFloat(btn.style.top) || 0;
        const anchor = anchorFor(a, hx, hy);
        line.setAttribute("x1", String(anchor.x));
        line.setAttribute("y1", String(anchor.y));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
        const status = agentStateRef.current[a.id]?.status || "idle";
        line.setAttribute("class", connectorClass(status, !!a.ephemeral));
      });
    }

    function renderMap(force = false) {
      const rect = wrap!.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w < 40 || h < 40) return;

      const key = mapLayoutKey(w, h);
      if (
        !force &&
        layoutKeyRef.current === key &&
        canvas!.querySelector(".agent-bubble")
      ) {
        updateMapBubbleStates();
        return;
      }

      const cx = w / 2;
      const cy = h / 2;
      const compact = w < 520 ? "xs" : w < 860 ? "sm" : "lg";
      const radius =
        Math.min(w, h) *
        (compact === "xs" ? 0.36 : compact === "sm" ? 0.37 : 0.34);

      function posFor(agent: AgentDef, fallback: { x: number; y: number }) {
        if (agent.nx != null && agent.ny != null) {
          return { x: agent.nx * w, y: agent.ny * h };
        }
        return fallback;
      }

      const hub = posFor(ORCHESTRATOR, { x: cx, y: cy });
      const permanent = teamRef.current.filter((a) => !a.ephemeral);
      const helpers = teamRef.current.filter((a) => a.ephemeral);

      const placed = new Map<string, { x: number; y: number }>();
      placed.set("orchestrator", hub);

      const permanentNodes = permanent.map((a) => {
        const p = posFor(a, polarToXY(cx, cy, radius, a.angle ?? 0));
        placed.set(a.id, p);
        return {
          ...a,
          ...p,
          status: agentStateRef.current[a.id]?.status || "idle",
        };
      });

      const helperNodes = helpers.map((a) => {
        const parentPos =
          (a.parentId && placed.get(a.parentId)) || hub;
        // Orbit just outside the parent bubble so the connector is visible
        const ringBase = compact === "xs" ? 58 : compact === "sm" ? 64 : 72;
        const ring = Math.max(ringBase, Math.min(w, h) * 0.13);
        const siblingCount = Math.max(
          1,
          helpers.filter((h) => h.parentId === a.parentId).length
        );
        const siblingIndex = helpers
          .filter((h) => h.parentId === a.parentId)
          .findIndex((h) => h.id === a.id);
        const spread =
          siblingCount === 1
            ? (a.angle ?? -40) * (Math.PI / 180)
            : ((siblingIndex - (siblingCount - 1) / 2) * 48 +
                (a.angle ?? 0) * 0.15) *
              (Math.PI / 180);
        const raw = {
          x: parentPos.x + Math.cos(spread) * ring,
          y: parentPos.y + Math.sin(spread) * ring,
        };
        const pad = compact === "xs" ? 40 : compact === "sm" ? 46 : 52;
        const p = {
          x: Math.min(w - pad, Math.max(pad, raw.x)),
          y: Math.min(h - pad, Math.max(pad, raw.y)),
        };
        placed.set(a.id, p);
        return {
          ...a,
          ...p,
          status: agentStateRef.current[a.id]?.status || "idle",
        };
      });

      const nodes = [...permanentNodes, ...helperNodes];

      // Permanent agents → hub; guests → their parent bubble center
      const lines = nodes
        .map((n) => {
          const cls = connectorClass(n.status, !!n.ephemeral);
          const anchor =
            n.ephemeral && n.parentId && placed.get(n.parentId)
              ? placed.get(n.parentId)!
              : hub;
          return `<line data-to="${n.id}" class="${cls}" x1="${anchor.x}" y1="${anchor.y}" x2="${n.x}" y2="${n.y}" />`;
        })
        .join("");

      const orchStatus =
        agentStateRef.current.orchestrator?.status || "idle";

      const orchFill = fillPctFor("orchestrator");

      const hubHtml = `
        <button type="button" class="${bubbleClassNames("orchestrator", true, orchStatus, selectedRef.current, flashRef.current, heatPhaseOf("orchestrator"), celebrateRef.current)}"
          data-id="orchestrator"
          style="left:${hub.x}px;top:${hub.y}px;--sleep-phase:${sleepPhaseSec("orchestrator")}s"
          aria-label="Orchestrator, ${orchStatus}">
          <span class="rainbow-glow" aria-hidden="true"></span>
          <span class="success-burst" aria-hidden="true">✓</span>
          ${SLEEP_FX}
          ${STRESS_FX}
          <div class="droplet shape-hub" aria-hidden="true" style="--fill-pct:${orchFill}%">
            <span class="droplet-fill" aria-hidden="true"></span>
            ${charHtml(ORCHESTRATOR, "anim-spin")}
          </div>
          <span class="label">Orchestrator</span>
          <span class="mini-chip">${celebrateRef.current ? "success" : orchStatus}</span>
        </button>
      `;

      const agentHtml = nodes
        .map(
          (n) => {
            const fill = fillPctFor(n.id, !!n.ephemeral);
            return `
            <button type="button" class="${bubbleClassNames(n.id, false, n.status, selectedRef.current, flashRef.current, heatPhaseOf(n.id), false, !!n.ephemeral)}" data-id="${n.id}"
              style="left:${n.x}px;top:${n.y}px;--sleep-phase:${sleepPhaseSec(n.id)}s" aria-label="${n.name}, ${n.status}${n.ephemeral ? ", temporary helper" : ""}">
              <span class="rainbow-glow" aria-hidden="true"></span>
              ${SLEEP_FX}
              ${STRESS_FX}
              <div class="droplet shape-${n.shape}" aria-hidden="true" style="--fill-pct:${fill}%">
                <span class="droplet-fill" aria-hidden="true"></span>
                ${charHtml(n, n.anim)}
              </div>
              <span class="label">${n.name}</span>
              <span class="mini-chip">${heatChipLabel(n.status, heatPhaseOf(n.id), !!n.ephemeral)}</span>
            </button>
          `;
          }
        )
        .join("");

      canvas!.innerHTML = `
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>
        ${hubHtml}
        ${agentHtml}
      `;
      layoutKeyRef.current = key;
    }

    function playPopOut(id: string) {
      const btn = canvas!.querySelector(`.agent-bubble[data-id="${id}"]`);
      if (!btn) return;
      btn.classList.remove("zoom-play");
      void (btn as HTMLElement).offsetWidth;
      btn.classList.add("zoom-play");
      const done = () => {
        btn.classList.remove("zoom-play");
        btn.removeEventListener("animationend", done);
      };
      btn.addEventListener("animationend", done);
    }

    renderMap(true);
    if (selectedRef.current) {
      requestAnimationFrame(() => playPopOut(selectedRef.current!));
    }

    const drag = {
      pointerId: null as number | null,
      id: null as string | null,
      node: null as HTMLElement | null,
      startClientX: 0,
      startClientY: 0,
      originX: 0,
      originY: 0,
      moved: false,
      dragging: false,
    };

    function canvasSize() {
      const r = canvas!.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }

    function clampBubble(x: number, y: number, w: number, h: number) {
      const pad = Math.min(56, Math.max(36, Math.min(w, h) * 0.14));
      return {
        x: Math.min(w - pad, Math.max(pad, x)),
        y: Math.min(h - pad, Math.max(pad, y)),
      };
    }

    function hitTestBubble(clientX: number, clientY: number) {
      let hit: HTMLElement | null = null;
      let best = Infinity;
      canvas!.querySelectorAll<HTMLElement>(".agent-bubble[data-id]").forEach((node) => {
        const r = node.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dist = Math.hypot(clientX - cx, clientY - cy);
        const reach = Math.max(r.width, r.height) * 0.62;
        if (dist <= reach && dist < best) {
          best = dist;
          hit = node;
        }
      });
      return hit;
    }

    function endBubbleDrag(e: PointerEvent) {
      if (drag.pointerId == null) return;
      if (e.pointerId != null && e.pointerId !== drag.pointerId) return;

      const node = drag.node;
      const id = drag.id;
      const wasDragging = drag.dragging;
      const moved = drag.moved;

      if (node) {
        try {
          node.releasePointerCapture(drag.pointerId);
        } catch {
          /* ignore */
        }
        node.classList.remove("dragging");
      }

      if (wasDragging && node && id) {
        const { w, h } = canvasSize();
        const x = parseFloat(node.style.left) || 0;
        const y = parseFloat(node.style.top) || 0;
        onPersistRef.current(id, x, y, w, h);
        syncConnectors();
      }

      drag.pointerId = null;
      drag.id = null;
      drag.node = null;
      drag.dragging = false;

      if (!moved && id) {
        onSelectRef.current(id);
        requestAnimationFrame(() => playPopOut(id));
      } else if (moved && id && selectedRef.current !== id) {
        onSelectRef.current(id);
      }
      drag.moved = false;
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button != null && e.button !== 0) return;
      let btn = (e.target as HTMLElement).closest?.(
        ".agent-bubble[data-id]"
      ) as HTMLElement | null;
      if (!btn || !canvas!.contains(btn)) {
        btn = hitTestBubble(e.clientX, e.clientY);
      }
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      drag.pointerId = e.pointerId;
      drag.id = btn.dataset.id!;
      drag.node = btn;
      drag.startClientX = e.clientX;
      drag.startClientY = e.clientY;
      drag.originX = parseFloat(btn.style.left) || 0;
      drag.originY = parseFloat(btn.style.top) || 0;
      drag.moved = false;
      drag.dragging = false;
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (drag.pointerId == null || e.pointerId !== drag.pointerId || !drag.node) {
        return;
      }
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (!drag.dragging && Math.hypot(dx, dy) < 6) return;
      if (!drag.dragging) {
        drag.dragging = true;
        drag.moved = true;
        drag.node.classList.add("dragging");
        drag.node.classList.remove("zoom-play");
      }
      e.preventDefault();
      const { w, h } = canvasSize();
      const next = clampBubble(drag.originX + dx, drag.originY + dy, w, h);
      drag.node.style.left = `${next.x}px`;
      drag.node.style.top = `${next.y}px`;
      syncConnectors();
    }

    canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    canvas.addEventListener("pointermove", onPointerMove, { passive: false });
    canvas.addEventListener("pointerup", endBubbleDrag);
    canvas.addEventListener("pointercancel", endBubbleDrag);

    const onResize = () => renderMap(true);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    // Re-draw when the wrap goes from 0→sized (e.g. switching Reports → Bubbles)
    const ro = new ResizeObserver(() => {
      renderMap(true);
    });
    ro.observe(wrap);

    updateMapBubbleStates();
    syncConnectors();
    // Second frame: body.view-bubbles may have just applied
    requestAnimationFrame(() => renderMap(true));

    return () => {
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endBubbleDrag);
      canvas.removeEventListener("pointercancel", endBubbleDrag);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [teamAgents.map((a) => a.id).join(",")]);

  // Soft state updates without full remount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas?.querySelector(".agent-bubble")) return;
    const svg = canvas.querySelector("svg");
    canvas.querySelectorAll<HTMLElement>(".agent-bubble[data-id]").forEach((node) => {
      const id = node.dataset.id!;
      const isHub = id === "orchestrator";
      const status = agentState[id]?.status || "idle";
      const keepZoom = node.classList.contains("zoom-play");
      const ephemeral = !!teamAgents.find((a) => a.id === id)?.ephemeral;
      const phase = heatPhaseOf(id);
      node.className = bubbleClassNames(
        id,
        isHub,
        status,
        selected,
        flashIds,
        phase,
        isHub && celebrateOrch,
        ephemeral
      );
      if (keepZoom) node.classList.add("zoom-play");
      const chip = node.querySelector(".mini-chip");
      if (chip) {
        chip.textContent =
          isHub && celebrateOrch
            ? "success"
            : heatChipLabel(status, phase, ephemeral);
      }
      const line = svg?.querySelector(`line.connector[data-to="${id}"]`);
      if (line) {
        line.setAttribute("class", connectorClass(status, ephemeral));
      }
      syncDropletFill(
        node.querySelector<HTMLElement>(".droplet"),
        fillPctFor(id, ephemeral)
      );
    });
    // Keep line endpoints glued to bubble centers after spawn / state ticks
    const hubBtn = canvas.querySelector<HTMLElement>(
      '.agent-bubble[data-id="orchestrator"]'
    );
    if (hubBtn && svg) {
      const hx = parseFloat(hubBtn.style.left) || 0;
      const hy = parseFloat(hubBtn.style.top) || 0;
      teamAgents.forEach((a) => {
        if (a.hub) return;
        const btn = canvas.querySelector<HTMLElement>(
          `.agent-bubble[data-id="${a.id}"]`
        );
        const line = svg.querySelector(`line.connector[data-to="${a.id}"]`);
        if (!btn || !line) return;
        const x2 = parseFloat(btn.style.left) || 0;
        const y2 = parseFloat(btn.style.top) || 0;
        let x1 = hx;
        let y1 = hy;
        if (a.ephemeral && a.parentId) {
          const parent = canvas.querySelector<HTMLElement>(
            `.agent-bubble[data-id="${a.parentId}"]`
          );
          if (parent) {
            x1 = parseFloat(parent.style.left) || hx;
            y1 = parseFloat(parent.style.top) || hy;
          }
        }
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
      });
    }
  }, [
    agentState,
    selected,
    flashIds,
    mapTick,
    celebrateOrch,
    teamAgents,
    workProgress,
    plannedTasks,
    running,
  ]);

  return (
    <div className="map-shell" id="mapShell">
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
      <div className="map-canvas-wrap" ref={wrapRef}>
        <div className="map-canvas" id="mapCanvas" ref={canvasRef} />
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
