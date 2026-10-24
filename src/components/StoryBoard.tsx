import { useCallback, useEffect, useId, useState } from "react";
import {
  fetchJiraStatus,
  fetchJiraStories,
  fetchJiraStory,
  type JiraStoryDetail,
  type JiraStoryListItem,
} from "../api/client";

type Props = {
  onApplyGoal: (goal: string) => void;
  disabled?: boolean;
};

export function StoryBoard({ onApplyGoal, disabled }: Props) {
  const titleId = useId();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [stories, setStories] = useState<JiraStoryListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<JiraStoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await fetchJiraStatus();
      setConfigured(status.configured);
      if (!status.configured) {
        setStories([]);
        return;
      }
      if (status.authOk === false) {
        setStories([]);
        setError(
          status.authError ||
            "Jira auth failed. Check JIRA_EMAIL + API token."
        );
        return;
      }
      const list = await fetchJiraStories();
      setStories(list);
      if (!list.length) {
        setError(
          `No open stories found${status.account ? ` (as ${status.account})` : ""}.`
        );
      }
    } catch (e) {
      setConfigured(true);
      setStories([]);
      setError(e instanceof Error ? e.message : "Could not load Jira stories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openStory(key: string) {
    if (disabled) return;
    if (selectedKey === key && detail) {
      setSelectedKey(null);
      setDetail(null);
      return;
    }
    setSelectedKey(key);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const story = await fetchJiraStory(key);
      setDetail(story);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Could not load issue");
    } finally {
      setDetailLoading(false);
    }
  }

  function useAsGoal() {
    if (!detail || disabled) return;
    onApplyGoal(detail.goal);
  }

  if (configured === false) {
    return (
      <section className="story-board" aria-labelledby={titleId}>
        <div className="story-board-head">
          <h3 id={titleId}>Jira stories</h3>
        </div>
        <p className="story-board-hint">
          Jira off — set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN on the API.
        </p>
      </section>
    );
  }

  return (
    <section className="story-board" aria-labelledby={titleId}>
      <div className="story-board-head">
        <div>
          <h3 id={titleId}>Jira stories</h3>
          <p className="story-board-sub">
            Open user stories — click a card for details
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost story-board-refresh"
          disabled={disabled || loading}
          onClick={() => void load()}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && !stories.length ? (
        <p className="story-board-hint story-board-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !stories.length ? (
        <div className="story-board-skeleton" aria-busy="true">
          <div className="story-card skeleton" />
          <div className="story-card skeleton" />
          <div className="story-card skeleton" />
        </div>
      ) : null}

      {stories.length > 0 ? (
        <div className="story-board-track" role="list">
          {stories.map((s) => {
            const active = selectedKey === s.key;
            return (
              <button
                type="button"
                role="listitem"
                key={s.key}
                className={`story-card${active ? " active" : ""}`}
                disabled={disabled}
                aria-pressed={active}
                onClick={() => void openStory(s.key)}
              >
                <span className="story-card-key">{s.key}</span>
                <span className="story-card-type">{s.issueType}</span>
                <span className="story-card-title">{s.summary}</span>
                <span className="story-card-meta">
                  <span className="story-card-status">{s.status}</span>
                  {s.assignee ? (
                    <span className="story-card-assignee">{s.assignee}</span>
                  ) : (
                    <span className="story-card-assignee muted">Unassigned</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {selectedKey ? (
        <div
          className="story-detail"
          role="region"
          aria-label={`Details for ${selectedKey}`}
        >
          {detailLoading ? (
            <p className="story-detail-loading">Loading {selectedKey}…</p>
          ) : null}
          {detailError ? (
            <p className="story-board-error" role="alert">
              {detailError}
            </p>
          ) : null}
          {detail ? (
            <>
              <div className="story-detail-top">
                <div>
                  <p className="story-detail-key">
                    <a href={detail.url} target="_blank" rel="noreferrer">
                      {detail.key}
                    </a>
                    <span className="story-detail-badge">{detail.issueType}</span>
                    <span className="story-detail-badge status">
                      {detail.status}
                    </span>
                  </p>
                  <h4 className="story-detail-title">{detail.summary}</h4>
                  {detail.assignee ? (
                    <p className="story-detail-assignee">
                      Assignee · {detail.assignee}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setSelectedKey(null);
                    setDetail(null);
                  }}
                >
                  Close
                </button>
              </div>

              {detail.description ? (
                <div className="story-detail-block">
                  <h5>Description</h5>
                  <pre className="story-detail-body">{detail.description}</pre>
                </div>
              ) : (
                <p className="story-board-hint">No description on this issue.</p>
              )}

              {detail.acceptanceCriteria ? (
                <div className="story-detail-block">
                  <h5>Acceptance criteria</h5>
                  <pre className="story-detail-body">
                    {detail.acceptanceCriteria}
                  </pre>
                </div>
              ) : null}

              <div className="story-detail-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={disabled}
                  onClick={useAsGoal}
                >
                  Use as goal
                </button>
                <a
                  className="btn-ghost story-detail-link"
                  href={detail.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Jira
                </a>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
