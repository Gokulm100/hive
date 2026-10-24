import { useCallback, useEffect, useId, useState } from "react";
import {
  fetchJiraStatus,
  fetchJiraStories,
  fetchJiraStory,
  type JiraStoryDetail,
  type JiraStoryListItem,
} from "../api/client";

export type StorySelection = {
  key: string | null;
  detail: JiraStoryDetail | null;
  loading: boolean;
  error: string | null;
};

type Props = {
  onApplyGoal: (goal: string) => void;
  disabled?: boolean;
  /** Fired when selection / detail load state changes (for the right rail). */
  onSelectionChange?: (sel: StorySelection) => void;
  /** When false, only the card strip is rendered (detail lives in the parent rail). */
  showInlineDetail?: boolean;
  /** Bump to clear the active card (e.g. when the rail Close is pressed). */
  clearEpoch?: number;
};

const EMPTY_SEL: StorySelection = {
  key: null,
  detail: null,
  loading: false,
  error: null,
};

/** Lines that read as section labels inside freeform Jira story text. */
function isStoryInlineHeading(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^#{1,3}\s+\S/.test(t)) return true;
  if (/^[A-Z][A-Za-z0-9 /&'()-]{1,48}:\s*$/.test(t)) return true;
  return /^(as a|i want|so that|acceptance criteria|given|when|then|and|but|scenario|background|notes?|context|goal|problem|solution|out of scope|dependencies|technical notes?)\b/i.test(
    t
  );
}

function StoryBody({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return (
    <div className="story-detail-body">
      {lines.map((line, i) => {
        const empty = !line.trim();
        if (empty) {
          return <div key={i} className="story-detail-body-gap" />;
        }
        const heading = isStoryInlineHeading(line);
        const label = line.replace(/^#{1,3}\s+/, "").trim();
        return (
          <p
            key={i}
            className={
              heading ? "story-detail-line heading" : "story-detail-line"
            }
          >
            {heading ? <strong>{label}</strong> : line}
          </p>
        );
      })}
    </div>
  );
}

export function StoryDetailPanel({
  selection,
  disabled,
  onApplyGoal,
  onClose,
}: {
  selection: StorySelection;
  disabled?: boolean;
  onApplyGoal: (goal: string) => void;
  onClose: () => void;
}) {
  const { key, detail, loading, error } = selection;

  if (!key) {
    return (
      <div className="story-rail-empty">
        <p className="story-rail-empty-title">Story detail</p>
        <p className="story-rail-empty-copy">
          Click a Jira card to read the full user story here.
        </p>
      </div>
    );
  }

  return (
    <div
      className="story-detail story-detail-rail"
      role="region"
      aria-label={`Details for ${key}`}
    >
      {loading ? (
        <p className="story-detail-loading">Loading {key}…</p>
      ) : null}
      {error ? (
        <p className="story-board-error" role="alert">
          {error}
        </p>
      ) : null}
      {detail ? (
        <>
          <header className="story-detail-top">
            <div className="story-detail-heading">
              <div className="story-detail-keyrow">
                <p className="story-detail-key">
                  <a href={detail.url} target="_blank" rel="noreferrer">
                    {detail.key}
                  </a>
                  <span className="story-detail-badge">{detail.issueType}</span>
                  <span className="story-detail-badge status">
                    {detail.status}
                  </span>
                </p>
                <div className="story-detail-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={disabled}
                    onClick={() => onApplyGoal(detail.goal)}
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
                  <button
                    type="button"
                    className="btn-ghost story-detail-close"
                    onClick={onClose}
                  >
                    Close
                  </button>
                </div>
              </div>
              <h4 className="story-detail-title">{detail.summary}</h4>
              {detail.assignee ? (
                <p className="story-detail-assignee">
                  <span className="story-detail-meta-label">Assignee</span>
                  {detail.assignee}
                </p>
              ) : (
                <p className="story-detail-assignee muted">Unassigned</p>
              )}
            </div>
          </header>

          <div className="story-detail-sections">
            {detail.description ? (
              <section className="story-detail-block">
                <h5 className="story-detail-section-title">Description</h5>
                <StoryBody text={detail.description} />
              </section>
            ) : (
              <p className="story-board-hint">No description on this issue.</p>
            )}

            {detail.acceptanceCriteria ? (
              <section className="story-detail-block">
                <h5 className="story-detail-section-title">
                  Acceptance criteria
                </h5>
                <StoryBody text={detail.acceptanceCriteria} />
              </section>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function StoryBoard({
  onApplyGoal,
  disabled,
  onSelectionChange,
  showInlineDetail = false,
  clearEpoch = 0,
}: Props) {
  const titleId = useId();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [stories, setStories] = useState<JiraStoryListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<JiraStoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const emit = useCallback(
    (sel: StorySelection) => {
      onSelectionChange?.(sel);
    },
    [onSelectionChange]
  );

  const clearSelection = useCallback(() => {
    setSelectedKey(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    emit(EMPTY_SEL);
  }, [emit]);

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

  useEffect(() => {
    if (clearEpoch > 0) clearSelection();
  }, [clearEpoch, clearSelection]);

  useEffect(() => {
    emit({
      key: selectedKey,
      detail,
      loading: detailLoading,
      error: detailError,
    });
  }, [selectedKey, detail, detailLoading, detailError, emit]);

  async function openStory(key: string) {
    if (disabled) return;
    if (selectedKey === key) {
      clearSelection();
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

  if (configured === false) {
    return (
      <section className="story-board" aria-labelledby={titleId}>
        <div className="story-board-head">
          <div>
            <h3 id={titleId}>Jira stories</h3>
            <p className="story-board-sub">
              Connect Jira to pull open user stories into this board
            </p>
          </div>
        </div>
        <p className="story-board-hint">
          Not connected. Set{" "}
          <code>JIRA_BASE_URL</code>, <code>JIRA_EMAIL</code>, and{" "}
          <code>JIRA_API_TOKEN</code> on the API, then refresh.
        </p>
      </section>
    );
  }

  const selection: StorySelection = {
    key: selectedKey,
    detail,
    loading: detailLoading,
    error: detailError,
  };

  return (
    <section className="story-board" aria-labelledby={titleId}>
      <div className="story-board-head">
        <div>
          <h3 id={titleId}>Jira stories</h3>
          <p className="story-board-sub">
            Open user stories — click a card to read the full story below
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
                <span className="story-card-keyrow">
                  <span className="story-card-key">{s.key}</span>
                  <span className="story-card-type">{s.issueType}</span>
                </span>
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

      {showInlineDetail && selectedKey ? (
        <StoryDetailPanel
          selection={selection}
          disabled={disabled}
          onApplyGoal={onApplyGoal}
          onClose={clearSelection}
        />
      ) : null}
    </section>
  );
}
