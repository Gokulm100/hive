import { useEffect, useId, useRef, useState, type FormEvent } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onAdd: (name: string, skills: string) => void;
};

export function AddAgentModal({ open, onClose, onAdd }: Props) {
  const [name, setName] = useState("");
  const [skills, setSkills] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    setName("");
    setSkills("");
    const t = window.setTimeout(() => nameRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(name.trim(), skills.trim());
    onClose();
  }

  return (
    <div
      className="agent-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="agent-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="agent-modal-head">
          <h3 id={titleId}>Add agent</h3>
          <button
            type="button"
            className="pop-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <form className="agent-modal-form" onSubmit={submit}>
          <label className="agent-modal-field">
            <span>Name</span>
            <input
              ref={nameRef}
              type="text"
              maxLength={24}
              required
              placeholder="e.g. Copy lead"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="agent-modal-field">
            <span>Instructions / skills</span>
            <textarea
              rows={5}
              maxLength={800}
              placeholder="What this agent should do, how they think, constraints…"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
            />
          </label>
          <div className="agent-modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Add to team
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
