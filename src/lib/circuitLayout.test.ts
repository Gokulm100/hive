import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORCHESTRATOR,
  createInitialAgents,
  makeCustomAgent,
} from "../data/cast.js";
import {
  buildCircuitEdges,
  circuitLayoutMinWidth,
  circuitTracePath,
  layoutCircuit,
  orderCircuitAgents,
} from "./circuitLayout.js";

describe("circuitLayout", () => {
  it("orders hub first then team by angle", () => {
    const team = createInitialAgents();
    const ordered = orderCircuitAgents([ORCHESTRATOR, ...team]);
    assert.equal(ordered[0]?.id, "orchestrator");
    const angles = ordered
      .slice(1)
      .filter((a) => !a.ephemeral)
      .map((a) => a.angle ?? 0);
    for (let i = 1; i < angles.length; i++) {
      assert.ok(angles[i] >= angles[i - 1], "team should sort by angle");
    }
  });

  it("links ephemerals to parent, others to hub", () => {
    const team = createInitialAgents();
    const helper = {
      ...team[0],
      id: "helper_1",
      ephemeral: true,
      parentId: "dev",
      hub: undefined,
    };
    const agents = [ORCHESTRATOR, ...team, helper];
    const edges = buildCircuitEdges(agents);
    assert.ok(edges.some((e) => e.from === "dev" && e.to === "helper_1"));
    assert.ok(edges.some((e) => e.from === "orchestrator" && e.to === "researcher"));
  });

  it("lays out nodes left-to-right with increasing x", () => {
    const team = createInitialAgents();
    const { nodes } = layoutCircuit([ORCHESTRATOR, ...team], 900, 400);
    const hub = nodes.find((n) => n.id === "orchestrator");
    const dev = nodes.find((n) => n.id === "dev");
    assert.ok(hub && dev);
    assert.ok(hub.x < dev.x, "hub should be left of dev in pipeline");
  });

  it("builds orthogonal trace paths", () => {
    const d = circuitTracePath(10, 20, 100, 20);
    assert.match(d, /^M 10 20 H 100$/);
    const bent = circuitTracePath(10, 20, 100, 80);
    assert.match(bent, /V 80/);
  });

  it("includes every team member and a newly added agent as nodes", () => {
    const team = createInitialAgents();
    const ids = new Set(team.map((a) => a.id));
    const custom = makeCustomAgent("Scribe", "Docs helper", ids);
    const agents = [ORCHESTRATOR, ...team, custom];
    const { nodes } = layoutCircuit(agents, 320, 400);
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const a of agents) {
      assert.ok(nodeIds.has(a.id), `expected node for ${a.id}`);
    }
  });

  it("expands layout width on narrow viewports so columns do not crowd", () => {
    const team = createInitialAgents();
    const agents = [ORCHESTRATOR, ...team];
    const minW = circuitLayoutMinWidth(agents);
    const { width } = layoutCircuit(agents, 320, 400);
    assert.ok(width >= minW);
    assert.ok(width > 320);
  });
});
