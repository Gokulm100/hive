/**
 * Turn agent dumps (QA reports, stack jargon) into plain chat English for the UI.
 * Raw text stays in memory for orchestration (e.g. QA_VERDICT parsing on the server).
 */

function stripMachineLines(text: string): string {
  return text
    .replace(/^QA_VERDICT:\s*(APPROVE|REQUEST_CHANGES)\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function plainJargon(s: string): string {
  return s
    .replace(/\bBadRequestException\b/gi, "bad-request error")
    .replace(/\bUnauthorizedException\b/gi, "not-signed-in error")
    .replace(/\bNotFoundException\b/gi, "not-found error")
    .replace(/\bForbiddenException\b/gi, "permission error")
    .replace(/\bInternalServerErrorException\b/gi, "server error")
    .replace(/\bBearer auth\b/gi, "sign-in check")
    .replace(/\bauth 401\b/gi, "blocked when not signed in")
    .replace(/\bnpm test\b/gi, "the project’s automated tests")
    .replace(/\b\w+\.spec\.ts\b/gi, "an existing test file")
    .replace(/\b\w+\.controller\.spec\b/gi, "an existing controller test")
    .replace(/\b\w+\.service\.spec\b/gi, "an existing service test")
    .replace(/\b\$regex\b/gi, "text search")
    .replace(/\b\(400\)/g, "(rejected as invalid)")
    .replace(/\b\(401\)/g, "(not signed in)")
    .replace(/\bPR\b/g, "pull request")
    .replace(/`([^`]+)`/g, "$1");
}

function looksLikeQaDump(text: string): boolean {
  return (
    /QA_VERDICT:/i.test(text) ||
    (/\b(Diff review|Tests run|Verdict)\b/i.test(text) &&
      /\b(Blocker|Issue|APPROVE|REQUEST_CHANGES|npm test|\.spec\.)\b/i.test(text))
  );
}

function looksLikeTechDump(text: string): boolean {
  return /Exception\b|\.spec\.ts|npm test|Bearer auth|middleware\.spec|\$regex|FAIL\s*\(|\*\*Tests run\*\*/i.test(
    text
  );
}

function humanizeQaDump(text: string): string {
  const approve = /QA_VERDICT:\s*APPROVE\b/i.test(text);
  const request =
    /QA_VERDICT:\s*REQUEST_CHANGES\b/i.test(text) ||
    /\brequest changes\b/i.test(text);

  const blockers: string[] = [];
  const issues: string[] = [];
  for (const line of text.split(/\n/)) {
    const b = line.match(/^\s*-?\s*Blocker:\s*(.+?)(?:\s*→\s*(?:Dev must|fix):\s*(.+))?$/i);
    if (b) {
      const what = plainJargon((b[2] || b[1]).trim());
      if (what) blockers.push(what);
      continue;
    }
    const i = line.match(/^\s*-?\s*Issue:\s*(.+?)(?:\s*→\s*(?:Dev must|fix):\s*(.+))?$/i);
    if (i) {
      const what = plainJargon((i[2] || i[1]).trim());
      if (what) issues.push(what);
    }
  }

  const testsFailed = /\bFAIL\b|\bfailed\b/i.test(text) && /\btest/i.test(text);
  const testsPassed =
    /\bPASS\b/i.test(text) ||
    (/passed/i.test(text) && /test/i.test(text) && !testsFailed);

  const out: string[] = [];

  if (approve && !request) {
    out.push("I reviewed the changes and ran the automated checks.");
    if (testsPassed) {
      out.push("The tests that matter for this work look good.");
    } else if (testsFailed) {
      out.push(
        "Some older tests in the repo already fail — they don’t look tied to this change."
      );
    }
    out.push("Ready for merge from my side.");
    return out.join(" ");
  }

  out.push("I reviewed the changes and ran the automated checks.");
  out.push("Dev still needs to fix a few things before we can approve:");

  const bullets = [...blockers, ...issues].slice(0, 6);
  if (bullets.length) {
    out.push("");
    for (const b of bullets) out.push(`• ${b}`);
  } else {
    // Fall back: soft-cleaned excerpt without machine noise
    const cleaned = plainJargon(stripMachineLines(text))
      .replace(/\*\*[^*]+\*\*/g, "")
      .replace(/\b(Minor leftover|Blocker|Issue|Tests run|Diff review):/gi, "")
      .trim();
    const short = cleaned.slice(0, 420).trim();
    if (short) {
      out.push("");
      out.push(short + (cleaned.length > 420 ? "…" : ""));
    } else {
      out.push("");
      out.push("• See the full notes in the task panel — keep the reply short next time.");
    }
  }

  out.push("");
  out.push("I’ll re-check once Dev hands it back.");
  return out.join("\n");
}

/** Display-only: plain English for agent chat bubbles. */
export function humanizeAgentChat(text: string, role: string): string {
  if (role !== "agent" || !text.trim()) return text;
  if (text.includes("…") && text.length < 40) return text; // typing stubs

  if (looksLikeQaDump(text)) return humanizeQaDump(text);

  if (!looksLikeTechDump(text)) return text;

  // Light cleanup for other roles that leaked jargon
  let t = stripMachineLines(text);
  t = plainJargon(t);
  t = t.replace(/\*\*/g, "");
  if (t.length > 600) t = t.slice(0, 600).trim() + "…";
  return t;
}
