/**
 * Review-bar live job count (issue #98): split the snapshot's jobs into
 * running vs queued for the small `1 · 2` indicator. One helper so the bar
 * and its tests share the mapping: `running` counts jobs on an agent now;
 * `queued` counts jobs waiting — `queued` for a free slot and
 * `backing-off` for its next retry. Terminal states
 * (done/error/cancelled) are not live and count for neither.
 */
import type { Job } from "@unvibe/shared";

export interface JobCounts {
  running: number;
  queued: number;
}

export function jobCounts(jobs: Job[]): JobCounts {
  let running = 0;
  let queued = 0;
  for (const job of jobs) {
    if (job.state === "running") running += 1;
    else if (job.state === "queued" || job.state === "backing-off") queued += 1;
  }
  return { running, queued };
}
