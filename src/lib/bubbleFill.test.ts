import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentBubbleFillPct,
  bubbleFillPctForId,
  orchestratorBubbleFillPct,
  runOverallProgressPct,
  stepsFillWithinBand,
} from "./bubbleFill.js";

describe("bubble fill mapping", () => {
  it("maps process steps within the active band", () => {
    assert.equal(stepsFillWithinBand(0, 12, 92), 12);
    assert.equal(stepsFillWithinBand(1, 12, 92), 19);
    assert.equal(stepsFillWithinBand(20, 12, 92), 92);
  });

  it("uses stage band plus steps for active agents", () => {
    assert.equal(
      agentBubbleFillPct({
        status: "working",
        taskPhase: "active",
        progress: { active: true, steps: 0, label: "Working…" },
      }),
      12
    );
    assert.equal(
      agentBubbleFillPct({
        status: "working",
        taskPhase: "active",
        progress: { active: true, steps: 3, label: "Step" },
      }),
      33
    );
    assert.equal(
      agentBubbleFillPct({ status: "idle", taskPhase: "upcoming" }),
      0
    );
    assert.equal(
      agentBubbleFillPct({
        status: "working",
        taskPhase: "upcoming",
        progress: { active: true, steps: 5, label: "Early" },
      }),
      0
    );
    const workingActive = agentBubbleFillPct({
      status: "working",
      taskPhase: "active",
      progress: { active: true, steps: 2, label: "Working…" },
    });
    assert.equal(
      agentBubbleFillPct({
        status: "blocked",
        taskPhase: "active",
        progress: { active: true, steps: 2, label: "Waiting on you" },
      }),
      workingActive
    );
    assert.equal(
      agentBubbleFillPct({ status: "done", taskPhase: "active" }),
      100
    );
    assert.equal(
      agentBubbleFillPct({ status: "idle", taskPhase: "done" }),
      100
    );
  });

  it("caps ephemeral helpers slightly lower in the active band", () => {
    assert.equal(
      agentBubbleFillPct({
        status: "working",
        taskPhase: "active",
        progress: { active: true, steps: 20, label: "Helping" },
        ephemeral: true,
      }),
      85
    );
  });

  it("shares overall progress percent with the task board", () => {
    const plannedTasks = [
      { id: "a", task: "A", phase: "done" as const },
      { id: "b", task: "B", phase: "active" as const },
      { id: "c", task: "C", phase: "upcoming" as const },
    ];
    assert.equal(runOverallProgressPct({ plannedTasks, running: true }), 48);
    assert.equal(
      orchestratorBubbleFillPct({
        plannedTasks,
        running: true,
      }),
      runOverallProgressPct({ plannedTasks, running: true })
    );
  });

  it("mirrors task-board overall progress for orchestrator", () => {
    assert.equal(
      orchestratorBubbleFillPct({
        plannedTasks: [
          { id: "a", task: "A", phase: "done" },
          { id: "b", task: "B", phase: "active" },
          { id: "c", task: "C", phase: "upcoming" },
        ],
        running: true,
      }),
      48
    );
    assert.equal(
      orchestratorBubbleFillPct({
        plannedTasks: [],
        running: true,
      }),
      8
    );
    assert.equal(
      orchestratorBubbleFillPct({
        plannedTasks: [{ id: "a", task: "A", phase: "done" }],
        running: false,
        celebrate: true,
      }),
      100
    );
  });

  it("routes orchestrator vs teammate ids", () => {
    const ctx = {
      agentState: {
        dev: { status: "working" as const },
        orchestrator: { status: "working" as const },
      },
      plannedTasks: [
        { id: "dev", task: "Build", phase: "active" as const },
        { id: "qa", task: "Test", phase: "done" as const },
      ],
      workProgress: {
        dev: { active: true, steps: 2, label: "Coding" },
      },
      running: true,
      celebrateOrch: false,
    };
    assert.equal(bubbleFillPctForId("dev", ctx), 26);
    assert.equal(bubbleFillPctForId("orchestrator", ctx), 73);
  });
});
