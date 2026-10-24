/**
 * Shared-site Jira Cloud client (Basic auth: email + API token).
 * Env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, optional JIRA_JQL / JIRA_PROJECT.
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

/** Default: all open User Stories (any assignee). Override with JIRA_JQL. */
export function defaultStoriesJql(): string {
  const custom = envTrim("JIRA_JQL");
  if (custom) return custom;
  const project = envTrim("JIRA_PROJECT");
  const projectClause = project ? `project = "${project}" AND ` : "";
  return (
    `${projectClause}` +
    `issuetype = Story AND statusCategory != Done ORDER BY updated DESC`
  );
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
  const url = `${jiraBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: authHeader(),
      ...(init?.headers || {}),
    },
  });
}

export async function searchStories(
  jql = defaultStoriesJql(),
  maxResults = 50
): Promise<JiraStoryListItem[]> {
  if (!jiraConfigured()) {
    throw new Error("Jira is not configured on this server");
  }

  // Prefer enhanced search; fall back to classic /search
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

  if (res.status === 404 || res.status === 405) {
    res = await jiraFetch("/rest/api/3/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, startAt: 0 }),
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Jira search failed (${res.status}): ${text.slice(0, 200) || res.statusText}`
    );
  }

  const data = (await res.json()) as {
    issues?: Array<{ key: string; fields?: Record<string, unknown> }>;
  };
  return (data.issues || []).map(mapListItem);
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
