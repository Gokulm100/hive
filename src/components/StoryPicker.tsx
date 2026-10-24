import { useCallback, useEffect, useState } from "react";
import {
  fetchJiraStatus,
  fetchJiraStories,
  fetchJiraStory,
  type JiraStoryListItem,
} from "../api/client";

type Props = {
  /** Called with a hydrated goal ready for the Orchestrator */
  onApplyGoal: (goal: string) => void;
  disabled?: boolean;
  compact?: boolean;
};

export function StoryPicker({ onApplyGoal, disabled, compact }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [stories, setStories] = useState<JiraStoryListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");

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
      const list = await fetchJiraStories();
      setStories(list);
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

  async function onChange(key: string) {
    setSelected(key);
    if (!key) return;
    setBusyKey(key);
    setError(null);
    try {
      const story = await fetchJiraStory(key);
      onApplyGoal(story.goal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load issue");
      setSelected("");
    } finally {
      setBusyKey(null);
    }
  }

  if (configured === false) {
    return (
      <div
        className={`story-picker${compact ? " compact" : ""}`}
        aria-label="Jira stories"
      >
        <p className="repo-hint">
          Jira off — set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN on the API.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`story-picker${compact ? " compact" : ""}`}
      aria-label="Jira user story"
    >
      <label className="repo-field">
        <span>Jira story</span>
        <select
          value={selected}
          disabled={disabled || loading || Boolean(busyKey)}
          onChange={(e) => void onChange(e.target.value)}
        >
          <option value="">
            {loading
              ? "Loading stories…"
              : busyKey
                ? "Loading issue…"
                : stories.length
                  ? "Pick a story to develop…"
                  : "No open-sprint stories"}
          </option>
          {stories.map((s) => (
            <option key={s.key} value={s.key}>
              {s.key}: {s.summary.slice(0, 72)}
              {s.summary.length > 72 ? "…" : ""}
            </option>
          ))}
        </select>
      </label>
      {!compact ? (
        <button
          type="button"
          className="btn-ghost"
          disabled={disabled || loading}
          onClick={() => void load()}
        >
          Refresh
        </button>
      ) : null}
      {error ? <p className="repo-hint story-picker-error">{error}</p> : null}
      {!compact && !error && configured && stories.length > 0 ? (
        <p className="repo-hint">
          Picks fill the goal box — review, then Send. Open sprint + assigned to
          the Jira API user.
        </p>
      ) : null}
    </div>
  );
}
