/**
 * One Explain-since-X run from the UI (issue #413): starts
 * `POST …/explain` with the chosen X, then follows the `explain-pass`
 * job by polling until it settles. On success the hook refetches the
 * snapshot itself (the existing job-result path: poll, then the same
 * `GET` the callers used to do) and reports through `onDone` whether
 * the run stored anything: a run whose reply carried no cards ends
 * "done" with the section untouched, and the caller shows "No changes
 * to explain since X" instead of going quiet. One agent call, only on
 * click — choosing X never reaches this hook.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Job, ReviewSnapshot } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { explainRunKey } from "./inflight.js";
import { useReview } from "../state/store.js";
import { explainXLabel, type ExplainX } from "./ExplainXSelect.js";

export type ExplainPhase =
  | { name: "idle" }
  | { name: "explaining"; jobId: string; job: Job | null }
  | { name: "failed"; message: string }
  | { name: "empty"; label: string };

function sectionKey(snapshot: ReviewSnapshot | null): string {
  return JSON.stringify(snapshot?.sinceSection ?? null);
}

export function useExplainPass(reviewId: string, onDone: (stored: boolean) => void): {
  phase: ExplainPhase;
  start: (x: ExplainX | null) => void;
} {
  const [phase, setPhase] = useState<ExplainPhase>({ name: "idle" });
  const timer = useRef<number | undefined>(undefined);
  const runRef = useRef(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A new review (or new head) resets the control and retires any
  // in-flight poll from the previous one.
  useEffect(() => {
    runRef.current += 1;
    setPhase({ name: "idle" });
  }, [reviewId]);

  const start = useCallback(
    (x: ExplainX | null): void => {
      const myRun = ++runRef.current;
      const alive = (): boolean => runRef.current === myRun;
      setPhase({ name: "explaining", jobId: "", job: null });
      const key = explainRunKey(reviewId);
      useReview.getState().beginInflight(key, "update");
      const label = x ? explainXLabel(x) : "…";
      const before = sectionKey(useReview.getState().snapshot);
      const body = x === null ? undefined : "version" in x ? { version: x.version } : { sha: x.sha };
      const finish = (): void => {
        useReview.getState().clearInflight(key);
      };
      const poll = async (jobId: string): Promise<void> => {
        let job: Job;
        try {
          job = (await api.job(jobId)).job;
        } catch {
          timer.current = window.setTimeout(() => void poll(jobId), 2000);
          return;
        }
        if (job.state === "queued" || job.state === "running" || job.state === "backing-off") {
          setPhase({ name: "explaining", jobId, job });
          timer.current = window.setTimeout(() => void poll(jobId), 1000);
          return;
        }
        finish();
        if (job.state === "done") {
          // The run stored nothing when the section is byte-identical
          // to the click (absent before and after, or an older run's).
          // The hook refetches once so every view lands together; the
          // caller only adjusts its own toast/refresh.
          let fresh: ReviewSnapshot | null = null;
          try {
            fresh = await api.review(reviewId);
            if (alive()) useReview.getState().setSnapshot(fresh);
          } catch {
            fresh = null;
          }
          if (!alive()) return;
          if (fresh && sectionKey(fresh) !== before) {
            setPhase({ name: "idle" });
            doneRef.current(true);
          } else if (fresh) {
            setPhase({ name: "empty", label });
            doneRef.current(false);
          } else {
            // The refetch failed: fall back to the legacy path (the
            // caller refreshes and reports as before).
            setPhase({ name: "idle" });
            doneRef.current(true);
          }
          return;
        }
        setPhase({ name: "failed", message: job.error ?? `The explain run didn't finish (${job.state}). Try again.` });
      };
      api
        .explain(reviewId, body)
        .then((res) => {
          if (!alive()) return;
          useReview.getState().attachInflightJob(key, res.jobId);
          setPhase({ name: "explaining", jobId: res.jobId, job: null });
          void poll(res.jobId);
        })
        .catch((err: unknown) => {
          if (!alive()) return;
          useReview.getState().clearInflight(key);
          const msg = err instanceof Error ? err.message : String(err);
          if (/501/.test(msg)) setPhase({ name: "failed", message: "Explain isn't available in this build" });
          else setPhase({ name: "failed", message: `Couldn't start the explain run: ${friendlyError(err)}` });
        });
    },
    [reviewId],
  );

  return { phase, start };
}

export function explainErrorMessage(phase: ExplainPhase): string | null {
  return phase.name === "failed" ? phase.message : null;
}
