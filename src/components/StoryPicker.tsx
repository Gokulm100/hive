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

export type StoryActionLabel = "Build" | "Review" | "Do QA" | "Analyse";

function normalizeStatus(status: string): string {
  return status
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Map Jira status → card action.
 * Priority: Ready for Stage+ → Do QA; In Dev completed+ → Review; To Do → Build; else Analyse.
 */
export function storyActionForStatus(status: string): StoryActionLabel {
  const s = normalizeStatus(status);

  if (
    /\bready for stage/.test(s) ||
    /\bready for staging/.test(s) ||
    /\bin stage\b/.test(s) ||
    /\bin staging\b/.test(s) ||
    /\bstaging\b/.test(s) ||
    /\bready for prod/.test(s) ||
    /\bready for production/.test(s) ||
    /\bin prod(uction)?\b/.test(s) ||
    /\buat\b/.test(s)
  ) {
    return "Do QA";
  }

  if (
    /\bin dev complet/.test(s) ||
    /\bdev complet/.test(s) ||
    /\bdevelopment complet/.test(s) ||
    /\bcode complet/.test(s) ||
    /\bdev done\b/.test(s) ||
    /\bready for review\b/.test(s) ||
    /\bawaiting review\b/.test(s)
  ) {
    return "Review";
  }

  if (
    s === "to do" ||
    s === "todo" ||
    s === "open" ||
    /\bto do\b/.test(s) ||
    /\btodo\b/.test(s)
  ) {
    return "Build";
  }

  return "Analyse";
}

function goalForAction(goal: string, action: StoryActionLabel): string {
  if (action === "Build") return goal;
  const verb =
    action === "Review"
      ? "Review"
      : action === "Do QA"
        ? "QA"
        : "Analyse";
  const swapped = goal.replace(/^Implement\b/, verb);
  if (swapped !== goal) return swapped;
  return `${action} this Jira story.\n\n${goal}`;
}

export function StoryPicker({ onApplyGoal, disabled, compact }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [stories, setStories] = useState<JiraStoryListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            "Jira auth failed. Check JIRA_EMAIL + API token (needs read:jira-work / read:me)."
        );
        return;
      }
      const list = await fetchJiraStories();
      setStories(list);
      if (!list.length) {
        setError(
          `No open stories found${status.account ? ` (as ${status.account})` : ""}. Types: ${(status.storyTypes || []).join(", ") || "—"}. Check Browse project permission.`
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

  async function onAction(story: JiraStoryListItem) {
    if (disabled || busyKey) return;
    setBusyKey(story.key);
    setError(null);
    try {
      const detail = await fetchJiraStory(story.key);
      const action = storyActionForStatus(detail.status || story.status);
      onApplyGoal(goalForAction(detail.goal, action));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load issue");
    } finally {
      setBusyKey(null);
    }
  }

  if (configured === false) {
    return (
      <div
        className={`story-picker story-picker-cards${compact ? " compact" : ""}`}
        aria-label="Jira stories"
      >
        <p className="repo-hint">
          Jira not connected — set env on the API to load stories.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`story-picker story-picker-cards${compact ? " compact" : ""}`}
      aria-label="Jira user stories"
    >
      <div className="story-picker-head">
        <p className="story-picker-label">Your stories</p>
        <button
          type="button"
          className="btn-ghost story-picker-refresh"
          disabled={disabled || loading}
          onClick={() => void load()}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loading && !stories.length ? (
        <div className="story-picker-track" aria-busy="true">
          <div className="story-card skeleton" />
          <div className="story-card skeleton" />
          <div className="story-card skeleton" />
        </div>
      ) : null}

      {stories.length > 0 ? (
        <div className="story-picker-track" role="list">
          {stories.map((s) => {
            const action = storyActionForStatus(s.status);
            const busy = busyKey === s.key;
            return (
              <article
                key={s.key}
                role="listitem"
                className={`story-card story-picker-card${busy ? " busy" : ""}`}
              >
                <span className="story-card-keyrow">
                  <span className="story-card-key">{s.key}</span>
                  <span className="story-card-status">{s.status}</span>
                </span>
                <span className="story-card-title">{s.summary}</span>
                <button
                  type="button"
                  className="btn-primary story-picker-action"
                  disabled={disabled || Boolean(busyKey)}
                  onClick={() => void onAction(s)}
                >
                  {busy ? "Loading…" : action}
                </button>
              </article>
            );
          })}
        </div>
      ) : null}

      {error ? <p className="repo-hint story-picker-error">{error}</p> : null}
    </div>
  );
}
