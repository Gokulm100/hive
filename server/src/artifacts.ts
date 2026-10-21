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

/** Filenames that signal internal work, not a shippable product. */
const INTERNAL_NAME_RE =
  /\b(brief|plan|outline|checklist|notes?|research|analysis|draft|spec|wireframe|acceptance|criteria|todo|backlog|summary-notes|meeting|scratch|wip|internal)\b/i;

/** Body that looks like planning / process docs, not a finished product. */
function looksLikeInternalDoc(body: string): boolean {
  const head = body.slice(0, 900);
  const hits = [
    /\bui\s*brief\b/i,
    /\bproduct\s*brief\b/i,
    /\bimplementation\s*plan\b/i,
    /\bproject\s*plan\b/i,
    /\bacceptance\s*criteria\b/i,
    /\bnext\s*steps\b/i,
    /\bopen\s*questions\b/i,
    /\bscope\s*(and|&)\s*priorit/i,
    /\brough\s*outline\b/i,
    /\binternal\s*(only|notes?|doc)\b/i,
    /^#{1,3}\s*(plan|brief|outline|research|notes|analysis)\b/im,
    /\b(todo|tbd|wip):\s/i,
  ].filter((re) => re.test(head)).length;
  return hits >= 1;
}

function looksLikeHtmlProduct(body: string): boolean {
  return (
    /<!doctype\s+html/i.test(body) ||
    (/<html[\s>]/i.test(body) && /<\/html>/i.test(body))
  );
}

function looksLikeCodeProduct(body: string, ext: string): boolean {
  const t = body.trim();
  if (!t || t.length < 8) return false;
  if (ext === "css") return /[{;:]/.test(t);
  if (ext === "js" || ext === "mjs") return /(?:function|=>|const|let|var|import|export)\b/.test(t);
  if (ext === "json") {
    try {
      JSON.parse(t);
      return true;
    } catch {
      return false;
    }
  }
  return t.length > 20;
}

/**
 * True only for shippable final products — never plans, briefs, or scratch notes.
 */
export function isFinalProductArtifact(name: string, body: string): boolean {
  const n = safeFileName(name).toLowerCase();
  const text = body.trim();
  if (!text) return false;

  if (INTERNAL_NAME_RE.test(n.replace(/[-_]+/g, " "))) return false;
  if (looksLikeInternalDoc(text) && !looksLikeHtmlProduct(text)) return false;

  if (n.endsWith(".html") || n.endsWith(".htm") || looksLikeHtmlProduct(text)) {
    return looksLikeHtmlProduct(text) || /<(?:body|main|section|header|div)[\s>]/i.test(text);
  }
  if (n.endsWith(".css")) return looksLikeCodeProduct(text, "css");
  if (n.endsWith(".js") || n.endsWith(".mjs")) return looksLikeCodeProduct(text, "js");
  if (n.endsWith(".json")) return looksLikeCodeProduct(text, "json");
  if (n.endsWith(".csv")) return /,/.test(text) && text.split(/\n/).length >= 2;
  if (n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".pdf")) {
    return text.length > 0;
  }

  // .md / .txt only if they look like a finished write-up, not process docs
  if (n.endsWith(".md") || n.endsWith(".txt") || n.endsWith("-response.txt")) {
    if (looksLikeInternalDoc(text)) return false;
    // Short conversational answers are ok (the answer IS the product)
    if (text.length <= 1200 && !/^#{1,3}\s/m.test(text.slice(0, 200))) return true;
    // Longer docs need a product-ish name (landing, copy, page, guide, FAQ…)
    if (
      /\b(copy|landing|page|guide|faq|script|email|announcement|release-notes|readme)\b/i.test(
        n.replace(/[-_]+/g, " ")
      )
    ) {
      return true;
    }
    return false;
  }

  // Unknown extension: allow only if HTML product slipped through
  return looksLikeHtmlProduct(text);
}

export function registerArtifactFile(opts: {
  jobId: string;
  name: string;
  content: string | Buffer;
  agentId?: string;
  /** Skip final-product gate (internal use only). */
  force?: boolean;
}): HiveArtifact | null {
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
  if (!opts.force) {
    const asText = Buffer.isBuffer(normalized)
      ? normalized.toString("utf8")
      : String(normalized);
    if (!isFinalProductArtifact(name, asText)) return null;
  }
  if (!normalized.length) return null;

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

/** Bare code fences that can be real products (not md/txt planning dumps). */
function collectLanguageBlocks(text: string): Block[] {
  const re = /```(html|htm|css|js|javascript)\s*\r?\n([\s\S]*?)```/gi;
  const out: Block[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const lang = match[1].toLowerCase();
    const ext =
      lang === "htm" || lang === "html"
        ? "html"
        : lang === "javascript"
          ? "js"
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
 * Named ```artifact``` wins; else html/css/js fences. Internal docs are dropped.
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
    if (!isFinalProductArtifact(block.name, body)) {
      // Still strip the fence from chat so plans don't dump as code blocks
      cleanText = cleanText.replace(block.full, "").trim();
      continue;
    }
    const art = registerArtifactFile({
      jobId,
      name: block.name,
      content: body,
      agentId,
    });
    if (!art) {
      cleanText = cleanText.replace(block.full, "").trim();
      continue;
    }
    found.push(art);
    cleanText = cleanText.replace(block.full, "").trim();
  }

  cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();
  return { cleanText, artifacts: found };
}

/**
 * Fallback only when the reply itself is a finished product
 * (full HTML page, or a short answer that is the deliverable — never a plan/brief).
 */
export function registerFinalResponseArtifact(opts: {
  jobId: string;
  agentName: string;
  agentId?: string;
  response: string;
}): HiveArtifact | null {
  const body = opts.response.trim();
  if (!body) return null;

  const looksHtml = looksLikeHtmlProduct(body);
  const name = looksHtml
    ? "index.html"
    : `${safeFileName(opts.agentName)}-response.txt`;

  if (!isFinalProductArtifact(name, body)) return null;

  return registerArtifactFile({
    jobId: opts.jobId,
    name,
    content: body,
    agentId: opts.agentId,
  });
}

export function artifactsPromptHint(): string {
  return `FINAL PRODUCT ARTIFACTS ONLY (strict):
- Artifacts = finished things the user can use (HTML page, CSS/JS file, finished copy).
- NEVER attach internal work: plans, briefs, research notes, outlines, checklists, acceptance criteria, scratch pads, or “how we’ll build it”.
- Those stay in chat only — not as downloads.
- Chat may include a short note; the downloadable file must contain ONLY the finished product.

When there IS a final product, use:

\`\`\`artifact name="index.html"
<!DOCTYPE html>
...complete final file only...
\`\`\`

Or:

\`\`\`html
<!DOCTYPE html>
...complete final file only...
\`\`\`

- Do NOT invent download URLs — Hive shows a Download button.
- Do NOT edit the project codebase unless this is Build mode and that is the task.`;
}
