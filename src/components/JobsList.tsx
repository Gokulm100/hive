import type { HiveJob } from "../types";

type Props = {
  jobs: HiveJob[];
  onStopJob?: (id: string) => void;
  onDeleteJob?: (id: string) => void;
};

function statusLabel(status: HiveJob["status"]) {
  switch (status) {
    case "running":
      return "running";
    case "done":
      return "done";
    case "cancelled":
      return "stopped";
    case "error":
      return "error";
    default:
      return status;
  }
}

function formatWhen(ts: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return "";
  }
}

export function JobsList({ jobs, onStopJob, onDeleteJob }: Props) {
  return (
    <section className="jobs-list" aria-label="Recent jobs">
      <div className="jobs-list-head">
        <h3>Jobs</h3>
        <span className="hint">Keeping the last 3</span>
      </div>
      {!jobs.length ? (
        <p className="jobs-empty">No jobs yet. Send a goal to start one.</p>
      ) : (
        <ul className="jobs-grid">
          {jobs.map((job) => (
            <li
              key={job.id}
              className={`job-card ${job.status}${
                job.mode === "brainstorm" || job.mode === "casual"
                  ? " brainstorm"
                  : ""
              }`}
            >
              <div className="job-top">
                <span
                  className={`chip ${
                    job.status === "running"
                      ? "working"
                      : job.status === "error"
                        ? "blocked"
                        : job.status === "done"
                          ? "done"
                          : "idle"
                  }`}
                >
                  {statusLabel(job.status)}
                </span>
                <span className="job-mode">
                  {job.mode === "casual"
                    ? "Casual"
                    : job.mode === "brainstorm"
                      ? "Brainstorm"
                      : "Build"}
                </span>
                <span className="job-when">
                  {formatWhen(job.finishedAt ?? job.startedAt)}
                </span>
              </div>
              <p className="job-goal">{job.goal}</p>
              {job.summary ? (
                <p className="job-summary">{job.summary}</p>
              ) : null}
              {job.workspaceUrl ? (
                <p className="job-repo">
                  {job.workspaceUrl.replace(/^https?:\/\/github\.com\//i, "")}
                </p>
              ) : null}
              {onStopJob || onDeleteJob ? (
                <div className="job-actions">
                  {job.status === "running" && onStopJob ? (
                    <button
                      type="button"
                      className="btn-ghost job-action"
                      onClick={() => onStopJob(job.id)}
                    >
                      Stop
                    </button>
                  ) : null}
                  {onDeleteJob ? (
                    <button
                      type="button"
                      className="btn-danger job-action"
                      onClick={() => onDeleteJob(job.id)}
                      title={
                        job.status === "running"
                          ? "Stop and remove this job"
                          : "Remove this job"
                      }
                    >
                      {job.status === "running" ? "Stop & delete" : "Delete"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
