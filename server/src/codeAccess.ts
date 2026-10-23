/** Built-in agent ids that may create, edit, or commit application code. */
export const CODE_WRITER_ROLE_IDS = new Set<string>(["dev", "designer"]);

export function canWriteCode(agentId: string): boolean {
  return CODE_WRITER_ROLE_IDS.has(agentId);
}

export function readOnlyCodeRules(agentLabel: string): string {
  return `CODE RULES (hard):
- Do NOT create, edit, delete, or commit application or source code.
- Only Dev and UI Designer may change code in this agent set.
- ${agentLabel} may plan, research, review diffs, merge PRs, or write plain reports — not patch the repo.
- If code must change, say Dev or UI Designer should do it.`;
}

export function devCodeAndTestRules(): string {
  return `CODE + TESTS (Dev):
- You may create, edit, and commit application code.
- While building a feature or fix, add or update unit tests for what you changed.
- QA runs tests read-only and sends failures back; fix only what they list.`;
}

export function designerCodeRules(): string {
  return `CODE (UI Designer):
- You may create, edit, and commit UI-related code (styles, components, layout) when the task needs it.
- Leave backend and unrelated Dev work to Dev unless the goal says otherwise.`;
}

export function codeRulesForAgent(agentId: string, agentName: string): string {
  if (agentId === "dev") return devCodeAndTestRules();
  if (agentId === "designer") return designerCodeRules();
  if (canWriteCode(agentId)) return "";
  return readOnlyCodeRules(agentName);
}

export function implementClosingLine(agentId: string): string {
  if (canWriteCode(agentId)) {
    return "Now implement / complete the assignment yourself in the workspace above. Use helper notes where useful. Explain what you're doing in plain language as you go. End with a short summary of what you decided or delivered (include PR/commit links if you created them).";
  }
  return "Now complete the assignment without changing application source code. Deliver your output in chat (and docs only if the task allows). Use helper notes where useful. End with a short plain-English summary.";
}
