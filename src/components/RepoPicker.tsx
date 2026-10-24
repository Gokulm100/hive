import type { ListedRepo } from "../api/client";

type Props = {
  repos: ListedRepo[];
  loading?: boolean;
  /** empty = default API cwd; __local__ = custom local folder; __custom__ = paste URL */
  value: string;
  branch: string;
  onRepo: (url: string) => void;
  onBranch: (branch: string) => void;
  customUrl: string;
  onCustomUrl: (url: string) => void;
  localPath: string;
  onLocalPath: (path: string) => void;
  /** Default cwd from API health (hint / fill) */
  defaultCwd?: string | null;
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
  localPath,
  onLocalPath,
  defaultCwd,
  disabled,
  compact,
}: Props) {
  const isLocal = value === "__local__";
  const isCustom = value === "__custom__";
  const isGithub = Boolean(value) && !isLocal && !isCustom;

  return (
    <div
      className={`repo-picker${compact ? " compact" : ""}`}
      aria-label="Workspace for this task"
    >
      <label className="repo-field">
        <span>Workspace</span>
        <select
          value={
            value === "__custom__" || value === "__local__" ? value : value
          }
          disabled={disabled}
          onChange={(e) => onRepo(e.target.value)}
        >
          <option value="">Default local folder (API host)</option>
          <option value="__local__">Choose local folder…</option>
          {repos.map((r) => (
            <option key={r.url} value={r.url}>
              {r.name}
            </option>
          ))}
          <option value="__custom__">Paste GitHub URL…</option>
        </select>
      </label>
      {isLocal ? (
        <label className="repo-field repo-local-path">
          <span>Local folder on API host</span>
          <input
            type="text"
            placeholder={defaultCwd || "/path/to/project"}
            value={localPath}
            disabled={disabled}
            onChange={(e) => onLocalPath(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {defaultCwd && !compact ? (
            <button
              type="button"
              className="btn-ghost repo-use-default"
              disabled={disabled}
              onClick={() => onLocalPath(defaultCwd)}
            >
              Use API default
            </button>
          ) : null}
        </label>
      ) : null}
      {isCustom ? (
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
          disabled={disabled || !isGithub}
          onChange={(e) => onBranch(e.target.value)}
          autoComplete="off"
        />
      </label>
      {!compact && loading ? (
        <p className="repo-hint">Loading connected repos…</p>
      ) : null}
      {!compact && !loading && isGithub ? (
        <p className="repo-hint">Agents will commit / open a PR on this repo.</p>
      ) : null}
      {!compact && !loading && isLocal ? (
        <p className="repo-hint">
          Path must exist on the machine running the Hive API (not only in the
          browser). Local Cursor agents use this folder as cwd.
        </p>
      ) : null}
      {!compact && !loading && !value ? (
        <p className="repo-hint">
          Default is the API host cwd{defaultCwd ? ` (${defaultCwd})` : ""}.
          Pick a GitHub repo for cloud agents, or choose a local folder.
        </p>
      ) : null}
    </div>
  );
}
