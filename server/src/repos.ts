import { Cursor } from "@cursor/sdk";
import { normalizeRepoUrl } from "./workspace";

function apiKey(): string {
  const key = process.env.CURSOR_API_KEY?.trim();
  if (!key) {
    throw new Error("CURSOR_API_KEY is missing");
  }
  return key;
}

export type ListedRepo = {
  url: string;
  name: string;
};

/** Extra repos from env: HIVE_REPOS=https://github.com/a/b,owner/c */
function envRepos(): ListedRepo[] {
  const raw = process.env.HIVE_REPOS?.trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const url = normalizeRepoUrl(s);
      const name = url.replace(/^https?:\/\/github\.com\//i, "") || url;
      return { url, name };
    });
}

export async function listConnectedRepos(): Promise<ListedRepo[]> {
  const fromEnv = envRepos();
  const byUrl = new Map<string, ListedRepo>();
  for (const r of fromEnv) byUrl.set(r.url.toLowerCase(), r);

  try {
    const list = await Cursor.repositories.list({ apiKey: apiKey() });
    for (const item of list as Array<Record<string, unknown>>) {
      const url = normalizeRepoUrl(
        String(item.url ?? item.htmlUrl ?? item.cloneUrl ?? item.repository ?? "")
      );
      if (!url) continue;
      const name = String(
        item.name ??
          item.fullName ??
          item.full_name ??
          url.replace(/^https?:\/\/github\.com\//i, "")
      );
      byUrl.set(url.toLowerCase(), { url, name });
    }
  } catch {
    /* Cursor.repositories may fail if GitHub not linked — env list still works */
  }

  return [...byUrl.values()].sort((a, b) => a.name.localeCompare(b.name));
}
