import { useState } from "react";
import { downloadAndDeleteArtifact } from "../api/client";
import type { HiveArtifact } from "../types";

type Props = {
  artifacts: HiveArtifact[];
  onRemoved?: (id: string) => void;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ArtifactsPanel({ artifacts, onRemoved }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!artifacts.length) return null;

  async function download(art: HiveArtifact) {
    setError(null);
    setBusyId(art.id);
    try {
      await downloadAndDeleteArtifact(art);
      onRemoved?.(art.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="artifacts-panel" aria-label="Downloadable artifacts">
      <div className="artifacts-panel-head">
        <h3>Artifacts</h3>
        <span className="hint">Download removes the file from the server</span>
      </div>
      {error ? <p className="artifacts-error">{error}</p> : null}
      <ul className="artifacts-grid">
        {artifacts.map((art) => (
          <li key={art.id} className="artifact-card">
            <div className="artifact-meta">
              <p className="artifact-name">{art.name}</p>
              <p className="artifact-size">{formatSize(art.size)}</p>
            </div>
            <button
              type="button"
              className="btn-primary artifact-download"
              disabled={busyId === art.id}
              onClick={() => void download(art)}
            >
              {busyId === art.id ? "Downloading…" : "Download"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
