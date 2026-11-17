/**
 * One Explain-since-X run from the UI (issue #413): starts
 * `POST …/explain` with the chosen X, then follows the `explain-pass`
 * job by polling until it settles, and refreshes the caller. One agent
 * call, only on click — choosing X never reaches this hook.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { explainRunKey } from "./inflight.js";
import { useReview } from "../state/store.js";
import type { ExplainX } from "./ExplainXSelect.js";

export type ExplainPhase =
  | { name: "idle" }
  | { name: "explaining"; jobId: string; job: Job | null }
  | { name: "failed"; message: string };

export function useExplainPass(reviewId: string, onDone: () => void): {
  phase: ExplainPhase;
  start: (x: ExplainX | null) => void;
} {
  const [phase, setPhase] = useState<ExplainPhase>({ name: "idle" });
  const timer = useRef<number | undefined>(undefined);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A new review (or new head) resets the control.
  useEffect(() => {
    setPhase({ name: "idle" });
  }, [reviewId]);

  const start = useCallback(
    (x: ExplainX | null): void => {
      setPhase({ name: "explaining", jobId: "", job: null });
      const key = explainRunKey(reviewId);
      useReview.getState().beginInflight(key, "update");
      const mySeq = useReview.getState().inflight[key]?.seq;
      const mine = (): boolean => useReview.getState().inflight[key]?.seq === mySeq;
      const body = x === null ? undefined : "version" in x ? { version: x.version } : { sha: x.sha };
      const finish = (): void => {
        if (mine()) useReview.getState().clearInflight(key);
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
          doneRef.current();
          setPhase({ name: "idle" });
          return;
        }
        setPhase({ name: "failed", message: job.error ?? `The explain run didn't finish (${job.state}). Try again.` });
      };
      api
        .explain(reviewId, body)
        .then((res) => {
          if (!mine()) return;
          useReview.getState().attachInflightJob(key, res.jobId);
          setPhase({ name: "explaining", jobId: res.jobId, job: null });
          void poll(res.jobId);
        })
        .catch((err: unknown) => {
          if (mine()) useReview.getState().clearInflight(key);
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
