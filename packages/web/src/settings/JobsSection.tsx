/**
 * Jobs section (PRD §4.14): running and queued jobs for the review, live
 * through the WebSocket `job` events. Each row shows kind, model/provider,
 * state (backing-off with the retry time), tokens, cache-hit rate, and a
 * toggle for the exact prompt it sent; cancel for active jobs. A totals row
 * sums tokens and the input-weighted cache-hit rate.
 */
import { useCallback, useEffect, useState } from "react";
import type { Job } from "@unvibe/shared";
import { api } from "../api/client.js";
import { connectEvents } from "../api/ws.js";
import {
  formatCacheRate,
  formatRetryIn,
  formatTokens,
  pooledCacheRate,
  pooledTokens,
  reduceJobs,
} from "../versions/versionUtils.js";

export function JobsSection({ reviewId }: { reviewId: string | null }): React.JSX.Element {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!reviewId) return;
    setError(null);
    try {
      setJobs((await api.jobs(reviewId)).jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [reviewId]);

  useEffect(() => {
    setJobs(null);
    void load();
  }, [load]);

  // Live updates: job events upsert into the list (reduceJobs also appends
  // jobs enqueued after the snapshot loaded, e.g. the update pass).
  useEffect(() => {
    if (!reviewId) return () => {};
    return connectEvents({
      reviewId,
      onEvent: (e) => setJobs((prev) => (prev === null ? prev : reduceJobs(prev, e))),
    });
  }, [reviewId]);

  const cancel = async (id: string): Promise<void> => {
    try {
      const res = await api.cancelJob(id);
      setJobs((prev) => (prev === null ? prev : reduceJobs(prev, { type: "job", job: res.job })));
    } catch {
      await load();
    }
  };

  const totals = pooledTokens(jobs ?? []);
  const rate = pooledCacheRate(jobs ?? []);

  return (
    <section aria-label="Jobs">
      <div className="divider">Jobs</div>
      {!reviewId ? (
        <p className="hint">Open settings from a review (`/settings?review=:id`) to see its jobs.</p>
      ) : error ? (
        <p className="err">{error}</p>
      ) : jobs === null ? (
        <p className="hint">Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <p className="hint">No jobs for this review.</p>
      ) : (
        <div className="card" style={{ padding: "4px 14px" }}>
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} onCancel={() => void cancel(j.id)} />
          ))}
          <div className="frow" style={{ gap: 8, padding: "8px 0" }} data-testid="jobs-totals">
            <span className="hint">
              Totals: {formatTokens(totals.input)} in · {formatTokens(totals.output)} out ·{" "}
              {formatTokens(totals.cached)} cached ({formatCacheRate(rate)})
            </span>
            <span className="sp" />
            <button className="x" type="button" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function JobRow({ job, onCancel }: { job: Job; onCancel: () => void }): React.JSX.Element {
  const [showPrompt, setShowPrompt] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(job.promptSnapshot ?? null);
  const [promptError, setPromptError] = useState<string | null>(null);

  const togglePrompt = async (): Promise<void> => {
    const next = !showPrompt;
    setShowPrompt(next);
    if (next && prompt === null) {
      setPromptError(null);
      try {
        setPrompt((await api.jobPrompt(job.id)).promptSnapshot);
      } catch (err) {
        setPromptError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const active = job.state === "queued" || job.state === "running" || job.state === "backing-off";

  return (
    <div className="jobrow" data-testid={`job-${job.id}`}>
      <div className="frow" style={{ gap: 8 }}>
        <span className="kind">{job.kind}</span>
        <span className={`st ${job.state}`} data-state={job.state}>
          {job.state === "backing-off" ? `backing-off · ${formatRetryIn(job.nextRetryAt)}` : job.state}
        </span>
        <span className="hint">
          {job.provider ? `${job.provider}/` : ""}
          {job.model}
        </span>
        <span className="sp" />
        {job.usage ? (
          <span className="hint">
            {formatTokens(job.usage.inputTokens)} in · {formatTokens(job.usage.outputTokens)} out ·{" "}
            {formatCacheRate(job.cacheHitRate)} cached
          </span>
        ) : (
          <span className="hint">no usage yet</span>
        )}
      </div>
      <div className="frow" style={{ gap: 8 }}>
        {job.progress ? <span className="hint">{job.progress}</span> : null}
        {job.error && job.state !== "backing-off" ? <span className="err">{job.error}</span> : null}
        {job.state === "backing-off" && job.error ? <span className="hint">{job.error}</span> : null}
        <span className="sp" />
        <button className="x" type="button" aria-expanded={showPrompt} onClick={() => void togglePrompt()}>
          {showPrompt ? "Hide prompt" : "Prompt"}
        </button>
        {active ? (
          <button className="x" type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      {showPrompt ? (
        promptError ? (
          <p className="err">{promptError}</p>
        ) : prompt !== null ? (
          <pre className="code">{prompt}</pre>
        ) : (
          <p className="hint">Loading prompt…</p>
        )
      ) : null}
    </div>
  );
}
