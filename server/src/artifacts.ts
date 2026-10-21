import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { bus } from "./bus";

export type HiveArtifact = {
  id: string;
  jobId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  agentId?: string;
};

type Stored = HiveArtifact & { absPath: string };

const rootDir = join(
  process.env.HIVE_CWD?.trim() ||
    process.env.NEXUS_CWD?.trim() ||
    process.cwd(),
  ".hive",
  "artifacts"
);

const store = new Map<string, Stored>();

function ensureRoot() {
  mkdirSync(rootDir, { recursive: true });
}

function safeFileName(raw: string): string {
  const base = basename(String(raw || "artifact").trim() || "artifact")
    .replace(/[^\w.\-()+ ]+/g, "_")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return base || "artifact.txt";
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".html") || lower.endsWith(".htm"))
    return "text/html; charset=utf-8";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function emitList(jobId?: string) {
  const jobs = listArtifacts(jobId);
  bus.emitEvent({ type: "artifacts", artifacts: jobs });
}

export function listArtifacts(jobId?: string): HiveArtifact[] {
  const rows = [...store.values()]
    .filter((a) => (jobId ? a.jobId === jobId : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ absPath: _p, ...rest }) => rest);
  return rows;
}

export function getArtifact(id: string): Stored | null {
  return store.get(id) ?? null;
}

export function readArtifactBytes(id: string): Buffer | null {
  const row = store.get(id);
  if (!row || !existsSync(row.absPath)) return null;
  try {
    return readFileSync(row.absPath);
  } catch {
    return null;
  }
}

export function deleteArtifact(id: string): boolean {
  const row = store.get(id);
  if (!row) return false;
  try {
    if (existsSync(row.absPath)) unlinkSync(row.absPath);
  } catch {
    /* ignore */
  }
  store.delete(id);
  emitList();
  return true;
}

export function registerArtifactFile(opts: {
  jobId: string;
  name: string;
  content: string | Buffer;
  agentId?: string;
}): HiveArtifact {
  ensureRoot();
  const jobDir = join(rootDir, opts.jobId);
  mkdirSync(jobDir, { recursive: true });
  const name = safeFileName(opts.name);
  const id = randomUUID();
  const absPath = join(jobDir, `${id.slice(0, 8)}-${name}`);
  const buf = Buffer.isBuffer(opts.content)
    ? opts.content
    : Buffer.from(opts.content, "utf8");
  writeFileSync(absPath, buf);
  const row: Stored = {
    id,
    jobId: opts.jobId,
    name,
    mime: guessMime(name),
    size: buf.length,
    createdAt: Date.now(),
    agentId: opts.agentId,
    absPath,
  };
  store.set(id, row);
  const { absPath: _p, ...publicRow } = row;
  bus.emitEvent({ type: "artifact", action: "ready", artifact: publicRow });
  emitList();
  return publicRow;
}

/** Pull ```artifact name="…"``` fences from agent text; returns cleaned text. */
export function harvestArtifactsFromText(
  jobId: string,
  text: string,
  agentId?: string
): { cleanText: string; artifacts: HiveArtifact[] } {
  const found: HiveArtifact[] = [];
  const re =
    /```artifact\s+name\s*=\s*["']([^"']+)["']\s*\r?\n([\s\S]*?)```/gi;
  let cleanText = text;
  let match: RegExpExecArray | null;
  const replacements: Array<{ full: string; name: string; body: string }> = [];
  while ((match = re.exec(text)) !== null) {
    replacements.push({
      full: match[0],
      name: match[1],
      body: match[2].replace(/^\n/, "").replace(/\n$/, ""),
    });
  }
  for (const block of replacements) {
    const art = registerArtifactFile({
      jobId,
      name: block.name,
      content: block.body,
      agentId,
    });
    found.push(art);
    cleanText = cleanText.replace(block.full, "").trim();
  }
  // Collapse leftover blank lines
  cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();
  return { cleanText, artifacts: found };
}

export function artifactsPromptHint(): string {
  return `DELIVERABLE RULES:
- Prefer a normal chat reply.
- If you produce a reusable artifact (brief, outline, notes, checklist, etc.), ALSO include it as one or more fenced blocks exactly like this:

\`\`\`artifact name="short-name.md"
...full file contents...
\`\`\`

- You may include multiple artifact blocks.
- Do NOT invent download URLs — Hive will offer a download button.
- Do NOT edit the project codebase; artifacts go only in these fences.`;
}
