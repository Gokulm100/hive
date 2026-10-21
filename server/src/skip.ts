/** Agents the user asked to skip for the current run (upcoming or in-flight). */

const skipped = new Set<string>();

export class SkippedError extends Error {
  agentId: string;
  constructor(agentId: string, message = "Skipped by user") {
    super(message);
    this.name = "SkippedError";
    this.agentId = agentId;
  }
}

export function clearSkipped() {
  skipped.clear();
}

export function markSkip(agentId: string) {
  const id = agentId.trim();
  if (id) skipped.add(id);
}

export function isSkipped(agentId: string) {
  return skipped.has(agentId);
}

export function throwIfSkipped(agentId: string) {
  if (skipped.has(agentId)) throw new SkippedError(agentId);
}
