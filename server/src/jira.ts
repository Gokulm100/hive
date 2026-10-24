/**
 * Shared-site Jira Cloud client (Basic auth: email + API token).
 * Env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, optional JIRA_JQL / JIRA_PROJECT.
 *
 * Scoped API tokens need read:jira-work (search/issues) and usually read:me /
 * read:jira-user. The token account must also have Browse projects.
 */

function envTrim(name: string): string {
  return (process.env[name] || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

export type JiraStoryListItem = {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  assignee?: string;
  url: string;
};

export type JiraStoryDetail = JiraStoryListItem & {
  description: string;
  acceptanceCriteria: string;
  /** Ready-to-send Hive goal */
  goal: string;
};

export type JiraStatusInfo = {
  configured: boolean;
  baseUrl: string | null;
  defaultJql: string | null;
  authOk: boolean | null;
  authError: string | null;
  account: string | null;
  storyTypes: string[];
};

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
};

export function jiraConfigured(): boolean {
  return Boolean(
    envTrim("JIRA_BASE_URL") &&
      envTrim("JIRA_EMAIL") &&
      envTrim("JIRA_API_TOKEN")
  );
}

export function jiraBaseUrl(): string {
  return envTrim("JIRA_BASE_URL").replace(/\/$/, "");
}

function authHeader(): string {
  const raw = `${envTrim("JIRA_EMAIL")}:${envTrim("JIRA_API_TOKEN")}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function projectClause(): string {
  const project = envTrim("JIRA_PROJECT");
  return project ? `project = "${project}" AND ` : "";
}

function quoteJqlString(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}

/** Build open-story JQL; uses discovered type names when available. */
export function buildOpenStoriesJql(storyTypeNames: string[]): string {
  const custom = envTrim("JIRA_JQL");
  if (custom) return custom;
  const types =
    storyTypeNames.length > 0
      ? storyTypeNames
      : ["Story", "User Story"];
  const typeClause =
    types.length === 1
      ? `issuetype = ${quoteJqlString(types[0])}`
      : `issuetype in (${types.map(quoteJqlString).join(", ")})`;
  return (
    `${projectClause()}${typeClause} AND statusCategory != Done ORDER BY updated DESC`
  );
}

/** @deprecated use buildOpenStoriesJql — kept for status preview before types load */
export function defaultStoriesJql(): string {
  return buildOpenStoriesJql(["Story", "User Story"]);
}

function adfToPlain(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";
  const n = node as AdfNode;
  if (n.type === "text" && typeof n.text === "string") return n.text;
  const kids = Array.isArray(n.content) ? n.content.map(adfToPlain).join("") : "";
  if (n.type === "paragraph" || n.type === "heading") return `${kids}\n`;
  if (n.type === "listItem") return `- ${kids.trim()}\n`;
  if (n.type === "hardBreak") return "\n";
  return kids;
}

function fieldToPlain(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  return adfToPlain(value).trim();
}

/** Pull “Acceptance Criteria” from description headings or a common custom field. */
function extractAcceptance(
  description: string,
  fields: Record<string, unknown>
): string {
  const customAc = envTrim("JIRA_AC_FIELD");
  if (customAc && fields[customAc] != null) {
    const plain = fieldToPlain(fields[customAc]);
    if (plain) return plain;
  }
  const match = description.match(
    /acceptance\s*criteria[:\s]*\n?([\s\S]*?)(?=\n#{1,3}\s|\n[A-Z][a-z]+ \w+:|$)/i
  );
  if (match?.[1]?.trim()) return match[1].trim();
  return "";
}

function issueUrl(key: string): string {
  return `${jiraBaseUrl()}/browse/${key}`;
}

function mapListItem(issue: {
  key: string;
  fields?: Record<string, unknown>;
}): JiraStoryListItem {
  const fields = issue.fields || {};
  const status = fields.status as { name?: string } | undefined;
  const issueType = fields.issuetype as { name?: string } | undefined;
  const assignee = fields.assignee as { displayName?: string } | undefined;
  return {
    key: issue.key,
    summary: String(fields.summary || "").trim() || issue.key,
    status: status?.name || "Unknown",
    issueType: issueType?.name || "Issue",
    assignee: assignee?.displayName,
    url: issueUrl(issue.key),
  };
}

async function jiraFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const base = jiraBaseUrl();
  if (!base) throw new Error("JIRA_BASE_URL is empty");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: authHeader(),
      ...(init?.headers || {}),
    },
  });
}

/** Verify Basic auth + return display name. */
export async function jiraMyself(): Promise<{
  accountId: string;
  displayName: string;
  emailAddress?: string;
}> {
  const res = await jiraFetch("/rest/api/3/myself");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      res.status === 401 || res.status === 403
        ? `Jira auth failed (${res.status}). Check JIRA_EMAIL + API token (scoped token needs read:jira-work / read:me). ${text.slice(0, 120)}`
        : `Jira /myself failed (${res.status}): ${text.slice(0, 160)}`
    );
  }
  const data = (await res.json()) as {
    accountId?: string;
    displayName?: string;
    emailAddress?: string;
  };
  return {
    accountId: data.accountId || "",
    displayName: data.displayName || data.emailAddress || "unknown",
    emailAddress: data.emailAddress,
  };
}

/** Issue type names that look like user stories on this site. */
export async function listStoryTypeNames(): Promise<string[]> {
  const res = await jiraFetch("/rest/api/3/issuetype");
  if (!res.ok) return ["Story", "User Story"];
  const types = (await res.json()) as Array<{ name?: string; subtask?: boolean }>;
  const matched = types
    .filter((t) => !t.subtask && t.name && /story/i.test(t.name))
    .map((t) => t.name as string);
  if (matched.length) return [...new Set(matched)];
  // Site has no *Story* type — still try common names
  return ["Story", "User Story"];
}

export async function getJiraStatusInfo(): Promise<JiraStatusInfo> {
  if (!jiraConfigured()) {
    return {
      configured: false,
      baseUrl: null,
      defaultJql: null,
      authOk: null,
      authError: null,
      account: null,
      storyTypes: [],
    };
  }
  let authOk: boolean | null = null;
  let authError: string | null = null;
  let account: string | null = null;
  let storyTypes: string[] = [];
  try {
    const me = await jiraMyself();
    authOk = true;
    account = me.displayName;
    storyTypes = await listStoryTypeNames();
  } catch (e) {
    authOk = false;
    authError = e instanceof Error ? e.message : String(e);
  }
  return {
    configured: true,
    baseUrl: jiraBaseUrl(),
    defaultJql: buildOpenStoriesJql(storyTypes),
    authOk,
    authError,
    account,
    storyTypes,
  };
}

async function postSearch(
  jql: string,
  maxResults: number
): Promise<{
  issues: Array<{ key: string; fields?: Record<string, unknown> }>;
}> {
  const body = {
    jql,
    maxResults,
    fields: ["summary", "status", "issuetype", "assignee"],
  };

  let res = await jiraFetch("/rest/api/3/search/jql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // Legacy fallback while some sites still expose classic search
  if (res.status === 404 || res.status === 405) {
    res = await jiraFetch("/rest/api/3/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, startAt: 0 }),
    });
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Jira search failed (${res.status}): ${text.slice(0, 240) || res.statusText}`
    );
  }

  let data: {
    issues?: Array<{ key: string; fields?: Record<string, unknown> }>;
  };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error(`Jira search returned non-JSON: ${text.slice(0, 120)}`);
  }
  return { issues: data.issues || [] };
}

export async function searchStories(
  jql?: string,
  maxResults = 50
): Promise<{ stories: JiraStoryListItem[]; jql: string }> {
  if (!jiraConfigured()) {
    throw new Error("Jira is not configured on this server");
  }

  // Fail fast with a clear message if token/email is wrong
  await jiraMyself();

  const storyTypes = await listStoryTypeNames();
  let query = (jql && jql.trim()) || buildOpenStoriesJql(storyTypes);

  let result = await postSearch(query, maxResults);

  // If Story type name was wrong / empty, fall back to all unfinished issues
  if (result.issues.length === 0 && !envTrim("JIRA_JQL") && !jql) {
    const fallback = `${projectClause()}statusCategory != Done ORDER BY updated DESC`;
    if (fallback !== query) {
      const second = await postSearch(fallback, maxResults);
      if (second.issues.length > 0) {
        result = second;
        query = fallback;
      }
    }
  }

  return {
    stories: result.issues.map(mapListItem),
    jql: query,
  };
}

export async function getStory(key: string): Promise<JiraStoryDetail> {
  if (!jiraConfigured()) {
    throw new Error("Jira is not configured on this server");
  }
  const clean = key.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(clean)) {
    throw new Error("Invalid issue key");
  }

  const res = await jiraFetch(
    `/rest/api/3/issue/${encodeURIComponent(clean)}?fields=summary,status,issuetype,assignee,description`
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Jira issue failed (${res.status}): ${text.slice(0, 200) || res.statusText}`
    );
  }

  const issue = (await res.json()) as {
    key: string;
    fields?: Record<string, unknown>;
  };
  const fields = issue.fields || {};
  const base = mapListItem(issue);
  const description = fieldToPlain(fields.description);
  const acceptanceCriteria = extractAcceptance(description, fields);

  const goal = buildGoalFromStory({
    ...base,
    description,
    acceptanceCriteria,
  });

  return {
    ...base,
    description,
    acceptanceCriteria,
    goal,
  };
}

export function buildGoalFromStory(story: {
  key: string;
  summary: string;
  url: string;
  description: string;
  acceptanceCriteria: string;
  issueType: string;
}): string {
  const parts = [
    `Implement Jira ${story.key} (${story.issueType}): ${story.summary}`,
    ``,
    `Issue: ${story.url}`,
  ];
  if (story.description) {
    parts.push(``, `Description:`, story.description);
  }
  if (story.acceptanceCriteria) {
    parts.push(``, `Acceptance criteria:`, story.acceptanceCriteria);
  }
  parts.push(
    ``,
    `Stay in scope for this story only. Implement, commit, and open a PR when done.`
  );
  return parts.join("\n").trim();
}
