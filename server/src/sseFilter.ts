import type { HiveEvent } from "./bus";
import { listArtifacts, type HiveArtifact } from "./artifacts";
import { getJob, listJobsPublic } from "./jobs";
import { getActiveRunUser } from "./runOwner";

function isLiveRunEvent(event: HiveEvent): boolean {
  if (event.type === "jobs" || event.type === "artifacts" || event.type === "artifact") {
    return false;
  }
  return true;
}

export function eventForUser(
  event: HiveEvent,
  userId: string
): HiveEvent | null {
  if (event.type === "jobs") {
    return { type: "jobs", jobs: listJobsPublic(userId) };
  }
  if (event.type === "artifacts") {
    return {
      type: "artifacts",
      artifacts: listArtifacts({ userId }),
    };
  }
  if (event.type === "artifact") {
    const job = getJob(event.artifact.jobId);
    if (!job || job.userId !== userId) return null;
    return event;
  }

  const owner = getActiveRunUser();
  if (owner && owner !== userId && isLiveRunEvent(event)) {
    return null;
  }
  return event;
}

export function initialArtifactsForUser(userId: string): HiveArtifact[] {
  return listArtifacts({ userId });
}
