import { useEffect, useRef, useState, type FormEvent } from "react";
import { charHtml } from "../data/chars";
import { ORCHESTRATOR } from "../data/cast";
import { polarToXY } from "../lib/utils";
import type { AgentDef, AgentRuntime } from "../types";

function connectorClass(status: string, ephemeral = false) {
  const parts = ["connector"];
  if (ephemeral) parts.push("ephemeral");
  // Dashed flow only for the agent currently working
  if (status === "working") parts.push("active");
  else if (status === "done" || status === "blocked") parts.push(status);
  return parts.join(" ");
}

type Props = {
  teamAgents: AgentDef[];
  agentState: Record<string, AgentRuntime>;
  selected: string | null;
  flashIds: Set<string>;
  mapTick: number;
  celebrateOrch: boolean;
  onSelect: (id: string) => void;
  onPersistPos: (id: string, x: number, y: number, w: number, h: number) => void;
  onAddAgent: (name: string, role: string) => void;
};

const STRESS_FX = `<span class="stress-fx" aria-hidden="true">
  <i class="steam s1"></i><i class="steam s2"></i><i class="steam s3"></i>
  <i class="sweat d1"></i><i class="sweat d2"></i><i class="sweat d3"></i>
</span>`;

function bubbleClassNames(
  id: string,
  isHub: boolean,
  status: string,
  selected: string | null,
  flashIds: Set<string>,
  overheating: boolean,
  celebrate: boolean,
  ephemeral = false
) {
  const sel = selected === id ? "selected" : "";
  const glow =
    selected === id || status === "working" || celebrate ? "glow" : "";
  const flash = flashIds.has(id) ? "flash" : "";
  const heat = overheating ? "overheating" : "";
  const cheer = celebrate ? "celebrate" : "";
  const sub = ephemeral ? "ephemeral" : "";
  return `agent-bubble ${isHub ? "hub" : ""} ${status} ${flash} ${sel} ${glow} ${heat} ${cheer} ${sub}`
    .replace(/\s+/g, " ")
    .trim();
}

export function BubbleMap({
  teamAgents,
  agentState,
  selected,
  flashIds,
  mapTick,
  celebrateOrch,
  onSelect,
  onPersistPos,
  onAddAgent,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected);
  const agentStateRef = useRef(agentState);
  const teamRef = useRef(teamAgents);
  const flashRef = useRef(flashIds);
  const celebrateRef = useRef(celebrateOrch);
  const heatRef = useRef(new Set<string>());
  const sinceRef = useRef(new Map<string, number>());
  const onSelectRef = useRef(onSelect);
  const onPersistRef = useRef(onPersistPos);

  selectedRef.current = selected;
  agentStateRef.current = agentState;
  teamRef.current = teamAgents;
  flashRef.current = flashIds;
  celebrateRef.current = celebrateOrch;
  onSelectRef.current = onSelect;
  onPersistRef.current = onPersistPos;

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [, setHeatTick] = useState(0);
  const layoutKeyRef = useRef("");

  // Track blocked immediately + long-running working → overheating
  useEffect(() => {
    const now = Date.now();
    const since = sinceRef.current;
    for (const [id, runtime] of Object.entries(agentState)) {
      if (runtime.status === "working" || runtime.status === "blocked") {
        if (!since.has(id)) since.set(id, now);
      } else {
        since.delete(id);
        heatRef.current.delete(id);
      }
    }
    const tick = window.setInterval(() => {
      const t = Date.now();
      let changed = false;
      for (const [id, started] of sinceRef.current) {
        const status = agentStateRef.current[id]?.status;
        const waitMs = status === "blocked" ? 1200 : 18000;
        const hot = t - started >= waitMs;
        if (hot && !heatRef.current.has(id)) {
          heatRef.current.add(id);
          changed = true;
        }
        if (!hot && heatRef.current.has(id)) {
          heatRef.current.delete(id);
          changed = true;
        }
      }
      if (changed) setHeatTick((n) => n + 1);
      // Keep class in sync on DOM without full remount
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.querySelectorAll<HTMLElement>(".agent-bubble[data-id]").forEach((node) => {
        const id = node.dataset.id!;
        node.classList.toggle("overheating", heatRef.current.has(id));
      });
    }, 800);
    return () => clearInterval(tick);
  }, [agentState]);

  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onAddAgent(name, role);
    setName("");
    setRole("");
  }

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
        node.className = bubbleClassNames(
          id,
          isHub,
          status,
          selectedRef.current,
          flashRef.current,
          heatRef.current.has(id),
          isHub && celebrateRef.current,
          ephemeral
        );
        if (keepZoom) node.classList.add("zoom-play");
        const chip = node.querySelector(".mini-chip");
        if (chip) {
          chip.textContent =
            isHub && celebrateRef.current
              ? "success"
              : heatRef.current.has(id) && status === "working"
                ? "slow…"
                : status;
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
      });
    }

    function anchorFor(agent: AgentDef, hubX: number, hubY: number) {
      if (agent.parentId) {
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
      const radius = Math.min(w, h) * 0.34;

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

      const helperNodes = helpers.map((a, i) => {
        const parentPos =
          (a.parentId && placed.get(a.parentId)) ||
          polarToXY(cx, cy, radius, a.angle ?? 0);
        const ring = Math.min(w, h) * 0.12;
        const ang = ((a.angle ?? 0) + i * 40) * (Math.PI / 180);
        const p = {
          x: parentPos.x + Math.cos(ang) * ring,
          y: parentPos.y + Math.sin(ang) * ring,
        };
        placed.set(a.id, p);
        return {
          ...a,
          ...p,
          status: agentStateRef.current[a.id]?.status || "idle",
        };
      });

      const nodes = [...permanentNodes, ...helperNodes];

      const lines = nodes
        .map((n) => {
          const cls = connectorClass(n.status, !!n.ephemeral);
          const anchor =
            n.parentId && placed.get(n.parentId)
              ? placed.get(n.parentId)!
              : hub;
          return `<line data-to="${n.id}" class="${cls}" x1="${anchor.x}" y1="${anchor.y}" x2="${n.x}" y2="${n.y}" />`;
        })
        .join("");

      const orchStatus =
        agentStateRef.current.orchestrator?.status || "idle";

      const hubHtml = `
        <button type="button" class="${bubbleClassNames("orchestrator", true, orchStatus, selectedRef.current, flashRef.current, heatRef.current.has("orchestrator"), celebrateRef.current)}"
          data-id="orchestrator"
          style="left:${hub.x}px;top:${hub.y}px"
          aria-label="Orchestrator, ${orchStatus}">
          <span class="rainbow-glow" aria-hidden="true"></span>
          <span class="success-burst" aria-hidden="true">✓</span>
          ${STRESS_FX}
          <div class="droplet shape-hub" aria-hidden="true">
            ${charHtml(ORCHESTRATOR, "anim-spin")}
          </div>
          <span class="label">Orchestrator</span>
          <span class="mini-chip">${celebrateRef.current ? "success" : orchStatus}</span>
        </button>
      `;

      const agentHtml = nodes
        .map(
          (n) => `
            <button type="button" class="${bubbleClassNames(n.id, false, n.status, selectedRef.current, flashRef.current, heatRef.current.has(n.id), false, !!n.ephemeral)}" data-id="${n.id}"
              style="left:${n.x}px;top:${n.y}px" aria-label="${n.name}, ${n.status}${n.ephemeral ? ", temporary helper" : ""}">
              <span class="rainbow-glow" aria-hidden="true"></span>
              ${STRESS_FX}
              <div class="droplet shape-${n.shape}" aria-hidden="true">
                ${charHtml(n, n.anim)}
              </div>
              <span class="label">${n.name}</span>
              <span class="mini-chip">${n.ephemeral ? "guest" : n.status}</span>
            </button>
          `
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
      const pad = 56;
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
      node.className = bubbleClassNames(
        id,
        isHub,
        status,
        selected,
        flashIds,
        heatRef.current.has(id),
        isHub && celebrateOrch,
        ephemeral
      );
      if (keepZoom) node.classList.add("zoom-play");
      const chip = node.querySelector(".mini-chip");
      if (chip) {
        chip.textContent =
          isHub && celebrateOrch
            ? "success"
            : ephemeral
              ? status === "done"
                ? "done"
                : "helper"
              : heatRef.current.has(id) && status === "working"
                ? "slow…"
                : status;
      }
      const line = svg?.querySelector(`line.connector[data-to="${id}"]`);
      if (line) {
        line.setAttribute("class", connectorClass(status, ephemeral));
      }
    });
  }, [agentState, selected, flashIds, mapTick, celebrateOrch, teamAgents]);

  return (
    <div className="map-shell" id="mapShell">
      <form className="add-agent-bar" onSubmit={add}>
        <input
          type="text"
          placeholder="New agent name"
          maxLength={24}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="text"
          placeholder="Role (optional)"
          maxLength={40}
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
        <button type="submit" className="btn-primary">
          Add agent
        </button>
      </form>
      <div className="map-canvas-wrap" ref={wrapRef}>
        <div className="map-canvas" id="mapCanvas" ref={canvasRef} />
      </div>
    </div>
  );
}
