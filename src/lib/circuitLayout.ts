import type { AgentDef } from "../types";

export type CircuitEdge = { from: string; to: string };

export type CircuitNodeLayout = {
  id: string;
  x: number;
  y: number;
};

export type CircuitLayout = {
  nodes: CircuitNodeLayout[];
  edges: CircuitEdge[];
  width: number;
  height: number;
};

const HUB_ID = "orchestrator";

/** Left-to-right: hub, then team by angle (workflow ring), helpers after their parent. */
export function orderCircuitAgents(agents: AgentDef[]): AgentDef[] {
  const hub = agents.find((a) => a.hub || a.id === HUB_ID);
  const permanent = agents
    .filter((a) => !a.hub && a.id !== HUB_ID && !a.ephemeral)
    .sort((a, b) => (a.angle ?? 0) - (b.angle ?? 0));
  const ephemeral = agents.filter((a) => a.ephemeral);

  const ordered: AgentDef[] = [];
  if (hub) ordered.push(hub);
  ordered.push(...permanent);

  const parentCol = new Map<string, number>();
  ordered.forEach((a, i) => parentCol.set(a.id, i));

  const helpersByParent = new Map<string, AgentDef[]>();
  for (const e of ephemeral) {
    const pid = e.parentId ?? HUB_ID;
    const list = helpersByParent.get(pid) ?? [];
    list.push(e);
    helpersByParent.set(pid, list);
  }
  for (const list of helpersByParent.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  const withHelpers: AgentDef[] = [...ordered];
  for (const a of ordered) {
    const helpers = helpersByParent.get(a.id);
    if (helpers?.length) withHelpers.push(...helpers);
  }
  for (const e of ephemeral) {
    if (!withHelpers.includes(e)) withHelpers.push(e);
  }

  return withHelpers;
}

export function buildCircuitEdges(agents: AgentDef[]): CircuitEdge[] {
  const edges: CircuitEdge[] = [];
  const ids = new Set(agents.map((a) => a.id));
  for (const a of agents) {
    if (a.hub || a.id === HUB_ID) continue;
    if (a.ephemeral && a.parentId && ids.has(a.parentId)) {
      edges.push({ from: a.parentId, to: a.id });
    } else {
      edges.push({ from: HUB_ID, to: a.id });
    }
  }
  return edges;
}

export function layoutCircuit(
  agents: AgentDef[],
  width: number,
  height: number
): CircuitLayout {
  const ordered = orderCircuitAgents(agents);
  const hubPresent = ordered.some((a) => a.hub || a.id === HUB_ID);
  const mainLine = ordered.filter((a) => !a.ephemeral);
  const ephemeral = ordered.filter((a) => a.ephemeral);

  const padX = Math.max(72, width * 0.06);
  const colCount = Math.max(1, mainLine.length);
  const colWidth =
    colCount <= 1 ? 0 : (width - padX * 2) / Math.max(1, colCount - 1);
  const centerY = height / 2;

  const pos = new Map<string, { x: number; y: number }>();

  mainLine.forEach((a, i) => {
    pos.set(a.id, { x: padX + colWidth * i, y: centerY });
  });

  if (!hubPresent && mainLine.length === 0 && ephemeral.length) {
    pos.set(ephemeral[0].id, { x: padX, y: centerY });
  }

  const helpersByParent = new Map<string, AgentDef[]>();
  for (const e of ephemeral) {
    const pid = e.parentId ?? HUB_ID;
    const list = helpersByParent.get(pid) ?? [];
    list.push(e);
    helpersByParent.set(pid, list);
  }

  for (const [parentId, helpers] of helpersByParent) {
    const parent = pos.get(parentId) ?? { x: padX, y: centerY };
    const rowGap = 88;
    helpers.forEach((h, idx) => {
      pos.set(h.id, {
        x: parent.x + (idx - (helpers.length - 1) / 2) * 36,
        y: parent.y + rowGap,
      });
    });
  }

  const nodes: CircuitNodeLayout[] = ordered
    .filter((a) => pos.has(a.id))
    .map((a) => {
      const p = pos.get(a.id)!;
      return { id: a.id, x: p.x, y: p.y };
    });

  const edges = buildCircuitEdges(ordered);

  return { nodes, edges, width, height };
}

/** Orthogonal PCB-style path between two points (for SVG d attribute). */
export function circuitTracePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const midX = x1 + (x2 - x1) * 0.55;
  if (Math.abs(y2 - y1) < 4) {
    return `M ${x1} ${y1} H ${x2}`;
  }
  return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
}
