export type AgentStatus = "idle" | "working" | "done" | "blocked";
export type ViewMode = "reports" | "bubbles";
export type ChatRole = "user" | "agent" | "system" | "process";
export type ActivityKind = "status" | "report" | "instruct" | "system" | "process";
export type OrchMsgKind = "user" | "orch";

export type AgentDef = {
  id: string;
  name: string;
  role: string;
  char: string;
  hub?: boolean;
  custom?: boolean;
  /** Temporary helper — appears then leaves when done */
  ephemeral?: boolean;
  parentId?: string;
  customSvg?: string;
  shape?: number;
  anim: string;
  angle?: number;
  nx?: number;
  ny?: number;
};

export type AgentRuntime = {
  status: AgentStatus;
  report: string;
  open: boolean;
};

export type ChatMessage = {
  role: ChatRole;
  text: string;
  typing?: boolean;
};

export type ActivityEntry = {
  t: number;
  id: string;
  name: string;
  kind: ActivityKind;
  status: AgentStatus;
  text: string;
};

export type OrchMessage = {
  id: string;
  kind: OrchMsgKind;
  text: string;
  extraClass?: string;
};

export type QuestionChoice = {
  id: string;
  label: string;
};

export type ClarifyingQuestion = {
  id: string;
  prompt: string;
  choices: QuestionChoice[];
  allowOther?: boolean;
};

export type QuestionAnswer = {
  questionId: string;
  choiceId: string;
  choiceLabel: string;
  note?: string;
};

export type PlannedTaskPhase = "upcoming" | "active" | "done" | "skipped";

export type PlannedTask = {
  id: string;
  task: string;
  phase: PlannedTaskPhase;
};

export type JobStatus = "running" | "done" | "cancelled" | "error";

export type HiveJob = {
  id: string;
  goal: string;
  mode: "build" | "brainstorm" | "casual";
  status: JobStatus;
  summary?: string;
  workspaceUrl?: string | null;
  startedAt: number;
  finishedAt?: number;
};

export type HiveArtifact = {
  id: string;
  jobId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  agentId?: string;
};

export type ScriptStep =
  | { delay: number; type: "orch" | "orch-summary"; text: string }
  | {
      delay: number;
      type: "agent";
      id: string;
      status: AgentStatus;
      report?: string;
    }
  | {
      delay: number;
      type: "guest-spawn";
      id: string;
      name: string;
      role: string;
      task: string;
    }
  | {
      delay: number;
      type: "guest-done";
      id: string;
      name: string;
      report?: string;
    };
