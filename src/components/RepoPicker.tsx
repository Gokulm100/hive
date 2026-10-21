import type { ListedRepo } from "../api/client";

type Props = {
  repos: ListedRepo[];
  loading?: boolean;
  /** empty string = local server workspace */
  value: string;
  branch: string;
  onRepo: (url: string) => void;
  onBranch: (branch: string) => void;
  customUrl: string;
  onCustomUrl: (url: string) => void;
  disabled?: boolean;
  /** Horizontal bar layout (map / reports toolbar) */
  compact?: boolean;
};

export function RepoPicker({
  repos,
  loading,
  value,
  branch,
  onRepo,
  onBranch,
  customUrl,
  onCustomUrl,
  disabled,
  compact,
}: Props) {
  return (
    <div
      className={`repo-picker${compact ? " compact" : ""}`}
      aria-label="Git repository for this task"
    >
      <label className="repo-field">
        <span>Repo to work on</span>
        <select
          value={value === "__custom__" ? "__custom__" : value}
          disabled={disabled}
          onChange={(e) => onRepo(e.target.value)}
        >
          <option value="">Local server folder (no GitHub)</option>
          {repos.map((r) => (
            <option key={r.url} value={r.url}>
              {r.name}
            </option>
          ))}
          <option value="__custom__">Paste GitHub URL…</option>
        </select>
      </label>
      {value === "__custom__" ? (
        <label className="repo-field">
          <span>GitHub URL</span>
          <input
            type="url"
            placeholder="https://github.com/org/repo"
            value={customUrl}
            disabled={disabled}
            onChange={(e) => onCustomUrl(e.target.value)}
            autoComplete="off"
          />
        </label>
      ) : null}
      <label className="repo-field repo-branch">
        <span>Branch (optional)</span>
        <input
          type="text"
          placeholder="main"
          value={branch}
          disabled={disabled || !value}
          onChange={(e) => onBranch(e.target.value)}
          autoComplete="off"
        />
      </label>
      {!compact && loading ? (
        <p className="repo-hint">Loading connected repos…</p>
      ) : null}
      {!compact && !loading && value && value !== "__custom__" ? (
        <p className="repo-hint">Agents will commit / open a PR on this repo.</p>
      ) : null}
      {!compact && !loading && !value ? (
        <p className="repo-hint">
          Pick a GitHub repo for cloud coding, or leave local for the API disk.
        </p>
      ) : null}
    </div>
  );
}
