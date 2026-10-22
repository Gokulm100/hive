import { useEffect, useId, useRef, useState, type FormEvent } from "react";

type Tab = "login" | "signup";

type Props = {
  open: boolean;
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onSignup: (email: string, password: string) => Promise<void>;
  reason?: string;
};

export function AuthModal({
  open,
  onClose,
  onLogin,
  onSignup,
  reason,
}: Props) {
  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    const t = window.setTimeout(() => emailRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === "login") {
        await onLogin(email.trim(), password);
      } else {
        await onSignup(email.trim(), password);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="agent-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="agent-modal auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="agent-modal-head">
          <h3 id={titleId}>Log in for Live mode</h3>
          <button
            type="button"
            className="pop-close"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </div>
        {reason ? <p className="auth-modal-reason">{reason}</p> : null}
        <div className="view-toggle auth-tabs" role="tablist" aria-label="Account">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "login"}
            aria-pressed={tab === "login"}
            onClick={() => setTab("login")}
            disabled={busy}
          >
            Log in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "signup"}
            aria-pressed={tab === "signup"}
            onClick={() => setTab("signup")}
            disabled={busy}
          >
            Sign up
          </button>
        </div>
        <form className="agent-modal-form" onSubmit={submit}>
          <label className="agent-modal-field">
            <span>Email</span>
            <input
              ref={emailRef}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="agent-modal-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={tab === "login" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
            {tab === "signup" ? (
              <span className="field-hint">At least 8 characters</span>
            ) : null}
          </label>
          {error ? (
            <p className="auth-modal-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="agent-modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Please wait…" : tab === "login" ? "Log in" : "Create account"}
            </button>
          </div>
        </form>
        <p className="auth-modal-foot">
          Demo mode works without an account. Live mode needs you to log in.
        </p>
      </div>
    </div>
  );
}
