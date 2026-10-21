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

export function safeFileName(raw: string): string {
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
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs"))
    return "text/javascript; charset=utf-8";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function emitList(jobId?: string) {
  bus.emitEvent({ type: "artifacts", artifacts: listArtifacts(jobId) });
}

export function listArtifacts(jobId?: string): HiveArtifact[] {
  return [...store.values()]
    .filter((a) => (jobId ? a.jobId === jobId : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ absPath: _p, ...rest }) => rest);
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

/** Keep only the final file body — strip plans, commentary, wrappers. */
export function normalizeFinalArtifactBody(
  name: string,
  body: string
): string {
  let text = body.replace(/^\uFEFF/, "").trim();
  if (!text) return text;

  const lowerName = name.toLowerCase();

  // Prefer a complete HTML document if present
  if (
    lowerName.endsWith(".html") ||
    lowerName.endsWith(".htm") ||
    /<!doctype\s+html/i.test(text) ||
    /<html[\s>]/i.test(text)
  ) {
    const doc = text.match(/<!doctype\s+html[\s\S]*<\/html>/i);
    if (doc) return doc[0].trim();
    const htmlOnly = text.match(/<html[\s\S]*<\/html>/i);
    if (htmlOnly) return htmlOnly[0].trim();
  }

  // Strip a single outer markdown fence if the whole body is wrapped
  const fenced = text.match(/^```[\w-]*\r?\n([\s\S]*?)\r?\n```$/);
  if (fenced) text = fenced[1].trim();

  // Drop leading “here is…” commentary before the real payload
  const lines = text.split(/\r?\n/);
  let start = 0;
  while (start < lines.length) {
    const line = lines[start].trim();
    if (!line) {
      start += 1;
      continue;
    }
    if (
      /^(here('s| is)|below is|i('ve| have)|sure[,!]?|okay[,!]?|alright[,!]?)/i.test(
        line
      ) &&
      line.length < 120 &&
      !line.includes("<") &&
      !line.startsWith("#") &&
      !line.startsWith("{")
    ) {
      start += 1;
      continue;
    }
    break;
  }
  text = lines.slice(start).join("\n").trim();

  return text;
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
  const normalized = Buffer.isBuffer(opts.content)
    ? opts.content
    : Buffer.from(
        normalizeFinalArtifactBody(name, opts.content),
        "utf8"
      );
  const id = randomUUID();
  const absPath = join(jobDir, `${id.slice(0, 8)}-${name}`);
  writeFileSync(absPath, normalized);
  const row: Stored = {
    id,
    jobId: opts.jobId,
    name,
    mime: guessMime(name),
    size: normalized.length,
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

type Block = { full: string; name: string; body: string };

function collectNamedArtifactBlocks(text: string): Block[] {
  const re =
    /```artifact\s+name\s*=\s*["']([^"']+)["']\s*\r?\n([\s\S]*?)```/gi;
  const out: Block[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push({
      full: match[0],
      name: match[1],
      body: match[2].replace(/^\n/, "").replace(/\n$/, ""),
    });
  }
  return out;
}

/** Bare ```html … ``` (or css/js) counts as a final file deliverable. */
function collectLanguageBlocks(text: string): Block[] {
  const re = /```(html|htm|css|js|javascript|json|txt|md|markdown)\s*\r?\n([\s\S]*?)```/gi;
  const out: Block[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const lang = match[1].toLowerCase();
    const ext =
      lang === "htm" || lang === "html"
        ? "html"
        : lang === "javascript"
          ? "js"
          : lang === "markdown"
            ? "md"
            : lang;
    out.push({
      full: match[0],
      name: ext === "html" ? "index.html" : `deliverable.${ext}`,
      body: match[2].replace(/^\n/, "").replace(/\n$/, ""),
    });
  }
  return out;
}

/**
 * Pull final deliverables from agent text.
 * Named ```artifact``` wins; else language fences (e.g. ```html).
 */
export function harvestArtifactsFromText(
  jobId: string,
  text: string,
  agentId?: string
): { cleanText: string; artifacts: HiveArtifact[] } {
  const found: HiveArtifact[] = [];
  let cleanText = text;

  const named = collectNamedArtifactBlocks(text);
  const blocks = named.length ? named : collectLanguageBlocks(text);

  for (const block of blocks) {
    const body = normalizeFinalArtifactBody(block.name, block.body);
    if (!body.trim()) continue;
    const art = registerArtifactFile({
      jobId,
      name: block.name,
      content: body,
      agentId,
    });
    found.push(art);
    cleanText = cleanText.replace(block.full, "").trim();
  }

  cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();
  return { cleanText, artifacts: found };
}

/** When no file fence exists, the agent's final reply IS the artifact. */
export function registerFinalResponseArtifact(opts: {
  jobId: string;
  agentName: string;
  agentId?: string;
  response: string;
}): HiveArtifact | null {
  const body = opts.response.trim();
  if (!body) return null;

  // If the reply itself is a full HTML page, save as .html
  const looksHtml =
    /<!doctype\s+html/i.test(body) || /<html[\s>]/i.test(body);
  const name = looksHtml
    ? "index.html"
    : `${safeFileName(opts.agentName)}-response.txt`;

  return registerArtifactFile({
    jobId: opts.jobId,
    name,
    content: body,
    agentId: opts.agentId,
  });
}

export function artifactsPromptHint(): string {
  return `FINAL ARTIFACT RULES (strict):
- Chat may include a short note, but the downloadable file must contain ONLY the final result.
- Examples:
  - User asked for an HTML page → artifact is the complete HTML document only (no UI brief, no plan, no “here’s how”).
  - User asked each agent a question (e.g. “how are you?”) → each agent’s final answer is the artifact (the reply itself).
- Prefer one fenced block for file deliverables:

\`\`\`artifact name="index.html"
<!DOCTYPE html>
...complete final file only...
\`\`\`

- Or a language fence for code files:

\`\`\`html
<!DOCTYPE html>
...complete final file only...
\`\`\`

- Do NOT put plans, briefs, checklists, or commentary inside the artifact body.
- Do NOT invent download URLs — Hive shows a Download button.
- Do NOT edit the project codebase.`;
}
