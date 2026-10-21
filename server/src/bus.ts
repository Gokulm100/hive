import { EventEmitter } from "node:events";

export type AgentStatus = "idle" | "working" | "done" | "blocked";

export type HiveEvent =
  | {
      type: "status";
      agentId: string;
      status: AgentStatus;
      report?: string;
    }
  | {
      type: "chat";
      agentId: string;
      role: "user" | "agent" | "system";
      text: string;
    }
  | {
      type: "orch";
      text: string;
      kind?: "summary" | "typing" | "normal";
    }
  | {
      type: "log";
      agentId: string;
      kind: "status" | "report" | "instruct" | "system" | "process";
      text: string;
      status?: AgentStatus;
    }
  | {
      type: "process";
      agentId: string;
      text: string;
    }
  | { type: "run"; running: boolean }
  | { type: "error"; message: string }
  | { type: "done" }
  | { type: "cancelled"; message?: string }
  | {
      type: "queued";
      agentId: string;
      text: string;
    }
  | {
      type: "awaiting";
      agentId: string;
      waiting: boolean;
      prompt?: string;
      questions?: Array<{
        id: string;
        prompt: string;
        choices: Array<{ id: string; label: string }>;
        allowOther?: boolean;
      }>;
    }
  | {
      type: "success";
      summary: string;
    }
  | {
      type: "subagent";
      action: "spawn" | "done" | "error";
      id: string;
      parentId: string;
      name: string;
      role: string;
      task?: string;
      report?: string;
    }
  | {
      type: "goal";
      goal: string;
    }
  | {
      type: "plan";
      goal: string;
      assignments: Array<{ id: string; task: string }>;
    }
  | {
      type: "task";
      agentId: string;
      phase: "active" | "done" | "skipped";
      task?: string;
    };

class Bus extends EventEmitter {
  emitEvent(event: HiveEvent) {
    this.emit("event", event);
  }
}

export const bus = new Bus();
