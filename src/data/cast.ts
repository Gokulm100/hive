import { ANIMS, hashStr, makeCustomSvg } from "./chars";
import type { AgentDef, AgentRuntime } from "../types";

export const DEFAULT_GOAL =
  "Plan a landing page for a specialty coffee brand.";

export const ORCHESTRATOR: AgentDef = {
  id: "orchestrator",
  name: "Orchestrator",
  role: "Routes work to the team",
  char: "orchestrator",
  hub: true,
  anim: "anim-spin",
};

export function createInitialAgents(): AgentDef[] {
  const shapes = [0, 1, 2, 3, 4].sort(() => Math.random() - 0.5);
  const anims = [...ANIMS].sort(() => Math.random() - 0.5);
  const base: AgentDef[] = [
    {
      id: "manager",
      name: "Manager",
      role: "Plans & prioritizes",
      char: "manager",
      angle: -90,
      shape: 0,
      anim: "anim-bob",
    },
    {
      id: "bd",
      name: "BD",
      role: "Business development",
      char: "bd",
      angle: -18,
      shape: 1,
      anim: "anim-wiggle",
    },
    {
      id: "designer",
      name: "UI Designer",
      role: "Visual & UX",
      char: "designer",
      angle: 54,
      shape: 2,
      anim: "anim-bounce",
    },
    {
      id: "dev",
      name: "Dev",
      role: "Implementation",
      char: "dev",
      angle: 126,
      shape: 3,
      anim: "anim-squash",
    },
    {
      id: "qa",
      name: "QA",
      role: "Quality checks",
      char: "qa",
      angle: 198,
      shape: 4,
      anim: "anim-tilt",
    },
  ];
  base.forEach((a, i) => {
    a.shape = shapes[i % shapes.length];
    a.anim = anims[i % anims.length];
  });
  redistributeAngles(base);
  return base;
}

export function redistributeAngles(agents: AgentDef[]) {
  const n = agents.length || 1;
  agents.forEach((a, i) => {
    a.angle = -90 + (360 / n) * i;
  });
}

export function initialRuntime(
  cast: AgentDef[]
): Record<string, AgentRuntime> {
  return Object.fromEntries(
    cast.map((a) => [
      a.id,
      {
        status: "idle" as const,
        report: a.hub
          ? "Ready to route work across the team."
          : "Waiting for assignment.",
        open: false,
      },
    ])
  );
}

export function makeCustomAgent(
  name: string,
  role: string,
  existingIds: Set<string>
): AgentDef {
  const trimmed = name.trim();
  const base =
    trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 20) || "agent";
  let id = base;
  let n = 2;
  while (existingIds.has(id)) id = `${base}_${n++}`;
  return {
    id,
    name: trimmed,
    role: (role || "Custom agent").trim() || "Custom agent",
    char: "custom",
    customSvg: makeCustomSvg(trimmed + id),
    custom: true,
    shape: hashStr(id) % 5,
    anim: ANIMS[hashStr(id + "a") % ANIMS.length],
    angle: 0,
  };
}

export function makeEphemeralAgent(
  id: string,
  name: string,
  role: string,
  parentId: string,
  parent?: AgentDef
): AgentDef {
  const parentAngle = parent?.angle ?? 0;
  const offset = ((hashStr(id) % 5) - 2) * 18;
  return {
    id,
    name: name.trim() || "Helper",
    role: (role || "Temporary helper").trim() || "Temporary helper",
    char: "custom",
    customSvg: makeCustomSvg(name + id),
    ephemeral: true,
    parentId,
    shape: hashStr(id) % 5,
    anim: ANIMS[hashStr(id + "e") % ANIMS.length],
    angle: parentAngle + offset,
    nx: parent?.nx,
    ny: parent?.ny,
  };
}
