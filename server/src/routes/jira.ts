import { Router } from "express";
import {
  getJiraStatusInfo,
  getStory,
  jiraConfigured,
  searchStories,
} from "../jira";

export const jiraRouter = Router();

jiraRouter.get("/status", async (_req, res) => {
  try {
    const info = await getJiraStatusInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({
      configured: jiraConfigured(),
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** Open User Stories assigned to currentUser(), or JIRA_JQL / JIRA_PROJECT. */
jiraRouter.get("/stories", async (req, res) => {
  if (!jiraConfigured()) {
    res.status(503).json({
      error:
        "Jira is not configured (set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN).",
      stories: [],
    });
    return;
  }
  try {
    const jql =
      typeof req.query.jql === "string" && req.query.jql.trim()
        ? req.query.jql.trim()
        : undefined;
    const { stories, jql: usedJql } = await searchStories(jql);
    res.json({ stories, jql: usedJql });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : String(err),
      stories: [],
    });
  }
});

jiraRouter.get("/issues/:key", async (req, res) => {
  if (!jiraConfigured()) {
    res.status(503).json({ error: "Jira is not configured" });
    return;
  }
  try {
    const story = await getStory(String(req.params.key || ""));
    res.json({ story });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /Invalid issue key/i.test(msg) ? 400 : 502;
    res.status(status).json({ error: msg });
  }
});
