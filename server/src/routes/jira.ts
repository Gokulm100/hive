import { Router } from "express";
import {
  defaultStoriesJql,
  getStory,
  jiraBaseUrl,
  jiraConfigured,
  searchStories,
} from "../jira";

export const jiraRouter = Router();

jiraRouter.get("/status", (_req, res) => {
  res.json({
    configured: jiraConfigured(),
    baseUrl: jiraConfigured() ? jiraBaseUrl() : null,
    defaultJql: jiraConfigured() ? defaultStoriesJql() : null,
  });
});

/** Open-sprint stories assigned to the Jira API user (or JIRA_JQL). */
jiraRouter.get("/stories", async (req, res) => {
  if (!jiraConfigured()) {
    res.status(503).json({
      error: "Jira is not configured (set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)",
      stories: [],
    });
    return;
  }
  try {
    const jql =
      typeof req.query.jql === "string" && req.query.jql.trim()
        ? req.query.jql.trim()
        : defaultStoriesJql();
    const stories = await searchStories(jql);
    res.json({ stories, jql });
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
