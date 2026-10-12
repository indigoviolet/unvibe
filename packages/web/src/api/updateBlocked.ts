/**
 * Jobs-running refusal from `POST /api/update/switch` (issue #36
 * follow-up: switch with running jobs).
 *
 * Leaf module: no imports, so the API client and the mock share it
 * without an import cycle (same shape as `./diagram.js`).
 *
 * The service refuses with 409 `{ error, code: "jobs-running",
 * activeJobs, jobs }`; this parses that body into a typed error so the
 * Version section renders the job list with a "Switch anyway" action
 * instead of a bare sentence.
 */
import type { UpdateBlockedJob } from "@unvibe/shared";

export class UpdateJobsBlockedError extends Error {
  activeJobs: number;
  jobs: UpdateBlockedJob[];
  constructor(activeJobs: number, jobs: UpdateBlockedJob[], detail?: string) {
    super(
      detail ??
        `cannot switch while ${activeJobs} job${activeJobs === 1 ? " is" : "s are"} running`,
    );
    this.name = "UpdateJobsBlockedError";
    this.activeJobs = activeJobs;
    this.jobs = jobs;
  }
}

function isBlockedJob(v: unknown): v is UpdateBlockedJob {
  const o = v as Record<string, unknown>;
  return (
    !!o &&
    typeof o["id"] === "string" &&
    typeof o["kind"] === "string" &&
    typeof o["state"] === "string" &&
    (o["reviewId"] === undefined || typeof o["reviewId"] === "string") &&
    (o["label"] === undefined || typeof o["label"] === "string")
  );
}

/**
 * Parse a switch 409 body into `UpdateJobsBlockedError`, or null when it
 * is any other refusal (submit in flight, pending switch, …).
 */
export function parseJobsBlocked(status: number, bodyText: string): UpdateJobsBlockedError | null {
  if (status !== 409) return null;
  try {
    const parsed = JSON.parse(bodyText) as {
      code?: unknown;
      activeJobs?: unknown;
      jobs?: unknown;
      error?: unknown;
    };
    if (parsed.code !== "jobs-running") return null;
    if (typeof parsed.activeJobs !== "number" || !Array.isArray(parsed.jobs)) return null;
    const jobs = (parsed.jobs as unknown[]).filter(isBlockedJob);
    const detail = typeof parsed.error === "string" && parsed.error.trim() !== "" ? parsed.error : undefined;
    return new UpdateJobsBlockedError(parsed.activeJobs, jobs, detail);
  } catch {
    return null;
  }
}
