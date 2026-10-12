/**
 * "New commits on this branch · Update" banner (PRD §8, §4.13, §4.2).
 *
 * Counts come from `versionStatus` on the snapshot (or the refresh
 * `comparison`, normalised by the caller). The range-diff view is a plain
 * collapsible `<details>`; Update runs `POST …/update` and follows the
 * job's progress by polling `GET /api/jobs/:id` until it leaves
 * queued/running/backing-off, then asks the parent to re-fetch.
 */
import { useEffect, useRef, useState } from "react";
import type { Job, VersionComparisonSummary, VersionStatus } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { updateKey } from "../guide/inflight.js";
import { useReview } from "../state/store.js";
import { versionCountsText } from "./versionUtils.js";

export interface BannerCounts {
  fromVersion: number;
  toVersion: number;
  changedHunks: number;
  newHunks: number;
  removedHunks: number;
  rangeDiff: string;
}

export function statusToBanner(s: VersionStatus): BannerCounts {
  return {
    fromVersion: s.fromVersion,
    toVersion: s.toVersion,
    changedHunks: s.changedHunks,
    newHunks: s.newHunks,
    removedHunks: s.removedHunks,
    rangeDiff: s.rangeDiff,
  };
}

export function comparisonToBanner(
  c: VersionComparisonSummary,
  reviewCurrentVersion: number,
): BannerCounts {
  return {
    fromVersion: c.oldVersion,
    toVersion: Math.max(c.newVersion, reviewCurrentVersion),
    changedHunks: c.changedHunks,
    newHunks: c.newHunks,
    removedHunks: c.removedHunks,
    rangeDiff: c.rangeDiff,
  };
}

type Phase =
  | { name: "idle" }
  | { name: "updating"; jobId: string; job: Job | null }
  | { name: "failed"; message: string };

export function VersionBanner({
  reviewId,
  counts,
  onUpdated,
}: {
  reviewId: string;
  counts: BannerCounts;
  onUpdated: () => void;
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A new stale state resets the banner (e.g. a second refresh round).
  useEffect(() => {
    setPhase({ name: "idle" });
  }, [counts.toVersion, counts.rangeDiff]);

  const startUpdate = async (): Promise<void> => {
    // Disabled + busy from this synchronous state set, before the request.
    setPhase({ name: "updating", jobId: "", job: null });
    const key = updateKey(reviewId);
    useReview.getState().beginInflight(key, "update");
    const mySeq = useReview.getState().inflight[key]?.seq;
    const mine = (): boolean => useReview.getState().inflight[key]?.seq === mySeq;
    let jobId: string;
    try {
      const res = await api.update(reviewId);
      jobId = res.jobId;
      if (mine()) useReview.getState().attachInflightJob(key, jobId);
    } catch (err) {
      if (mine()) useReview.getState().clearInflight(key);
      setPhase({ name: "failed", message: updateError(err) });
      return;
    }
    setPhase({ name: "updating", jobId, job: null });
    const finish = (): void => {
      if (mine()) useReview.getState().clearInflight(key);
    };
    const poll = async (): Promise<void> => {
      let job: Job;
      try {
        job = (await api.job(jobId)).job;
      } catch {
        timer.current = window.setTimeout(() => void poll(), 2000);
        return;
      }
      if (job.state === "queued" || job.state === "running" || job.state === "backing-off") {
        setPhase({ name: "updating", jobId, job });
        timer.current = window.setTimeout(() => void poll(), 1000);
        return;
      }
      finish();
      if (job.state === "done") {
        onUpdated();
        setPhase({ name: "idle" });
        return;
      }
      setPhase({ name: "failed", message: job.error ?? `The update didn't finish (${job.state}). Try again.` });
    };
    void poll();
  };

  const updating = phase.name === "updating" ? phase : null;

  return (
    <div className="dbar" data-testid="stale-banner" role="status">
      <span className="hint">
        New commits on this branch · v{counts.fromVersion} → v{counts.toVersion} (
        {versionCountsText(counts)} hunks)
      </span>
      <span className="sp" />
      {counts.rangeDiff.trim() !== "" ? (
        <details>
          <summary className="hint" style={{ cursor: "pointer" }}>
            range-diff
          </summary>
          <pre className="code" data-testid="range-diff">
            {counts.rangeDiff}
          </pre>
        </details>
      ) : null}
      {phase.name === "failed" ? <span className="hint">{phase.message}</span> : null}
      {updating ? (
        <span className="hint" data-testid="update-progress" aria-live="polite" role="status">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>{" "}
          Updating…
        </span>
      ) : (
        <button className="x" type="button" onClick={() => void startUpdate()}>
          Update
        </button>
      )}
    </div>
  );
}

function updateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/501/.test(msg)) return "Update isn't available in this build";
  if (/409/.test(msg)) return "Already up to date";
  return `Couldn't start the update: ${friendlyError(err)}`;
}
