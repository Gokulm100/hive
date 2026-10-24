import { useState } from "react";
import { pickLocalFolder, type ListedRepo } from "../api/client";

type Props = {
  repos: ListedRepo[];
  loading?: boolean;
  /** empty = default cwd; __local__ = folder on this computer; __custom__ = paste URL */
  value: string;
  branch: string;
  onRepo: (url: string) => void;
  onBranch: (branch: string) => void;
  customUrl: string;
  onCustomUrl: (url: string) => void;
  localPath: string;
  onLocalPath: (path: string) => void;
  /** Default cwd from health (hint / fill) */
  defaultCwd?: string | null;
  /** Native Browse… available (API running on this computer) */
  localFolderPick?: boolean;
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
  localFolderPick = false,
  disabled,
  compact,
}: Props) {
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const isLocal = value === "__local__";
  const isCustom = value === "__custom__";
  const isGithub = Boolean(value) && !isLocal && !isCustom;

  async function onBrowse() {
    if (disabled || picking) return;
    setPicking(true);
    setPickError(null);
    try {
      const path = await pickLocalFolder();
      onLocalPath(path);
      if (value !== "__local__") onRepo("__local__");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not pick folder";
      if (!/no folder selected/i.test(msg)) setPickError(msg);
    } finally {
      setPicking(false);
    }
  }

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
          <option value="">Default folder on this computer</option>
          <option value="__local__">Folder on this computer…</option>
          {repos.map((r) => (
            <option key={r.url} value={r.url}>
              {r.name}
            </option>
          ))}
          <option value="__custom__">Paste GitHub URL…</option>
        </select>
      </label>
      {isLocal ? (
        <div className="repo-field repo-local-path">
          <span>Folder on this computer</span>
          <div className="repo-local-row">
            <input
              type="text"
              placeholder={defaultCwd || "/Users/you/Projects/app"}
              value={localPath}
              disabled={disabled || picking}
              onChange={(e) => onLocalPath(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="btn-ghost repo-browse"
              disabled={disabled || picking || !localFolderPick}
              title={
                localFolderPick
                  ? "Open a folder picker on this computer"
                  : "Run Hive API on this computer (npm run dev) to browse"
              }
              onClick={() => void onBrowse()}
            >
              {picking ? "…" : "Browse…"}
            </button>
          </div>
          {!localFolderPick ? (
            <p className="repo-hint repo-local-warn">
              Browse needs Hive API on this computer (`npm run dev`). Or paste
              the full path below.
            </p>
          ) : null}
          {pickError ? (
            <p className="repo-hint story-picker-error">{pickError}</p>
          ) : null}
        </div>
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
      {!compact && !loading && isLocal && localFolderPick ? (
        <p className="repo-hint">
          Agents edit files in this folder on your machine.
        </p>
      ) : null}
      {!compact && !loading && !value ? (
        <p className="repo-hint">
          Default is this computer
          {defaultCwd ? ` (${defaultCwd})` : ""}. Pick a folder here, or a
          GitHub repo for cloud agents.
        </p>
      ) : null}
    </div>
  );
}
