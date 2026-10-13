/**
 * Jobs section (issue #32, PRD §4.14): running and queued jobs for the
 * review, live through the WebSocket `job` events. Each row shows kind,
 * model/provider, state (backing-off with the retry time), tokens,
 * cache-hit rate, and a toggle for the exact prompt it sent; cancel for
 * active jobs. A totals row sums tokens and the input-weighted cache-hit
 * rate. Relocated unchanged from Settings to the debug page; the
 * Markdown-only rule covers the shared-context parts, not this table.
 */
import { useCallback, useEffect, useState } from "react";
import type { Block, Job, ReviewSnapshot } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
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
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!reviewId) return;
    setError(null);
    try {
      const [jobList, snap] = await Promise.all([api.jobs(reviewId), api.review(reviewId)]);
      setJobs(jobList.jobs);
      setSnapshot(snap);
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [reviewId]);

  useEffect(() => {
    setJobs(null);
    setSnapshot(null);
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
      {!reviewId ? (
        <p className="hint">Open Debug from a review to see its jobs.</p>
      ) : error ? (
        <p className="err">{error}</p>
      ) : jobs === null ? (
        <p className="hint">Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <p className="hint">No jobs for this review.</p>
      ) : (
        <div className="card" style={{ padding: "4px 14px" }}>
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} diagramErrors={diagramErrorsFor(snapshot, j)} onCancel={() => void cancel(j.id)} />
          ))}
          <div className="frow" style={{ gap: 8, padding: "8px 0" }} data-testid="jobs-totals">
            <span className="hint">
              Totals: {formatTokens(totals.input)} in · {formatTokens(totals.output)} out ·{" "}
              {formatCacheRate(rate)} hit · {formatTokens(totals.written)} written
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

function JobRow({ job, diagramErrors, onCancel }: { job: Job; diagramErrors: string[]; onCancel: () => void }): React.JSX.Element {
  const [showPrompt, setShowPrompt] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(job.promptSnapshot ?? null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);

  // Same display as the pickers (#21): name beside the id when known.
  useEffect(() => {
    let cancelled = false;
    if (!job.provider || !job.model) return;
    api
      .models(job.provider)
      .then((r) => {
        if (cancelled) return;
        const found = r.models.find((m) => m.id === job.model);
        if (found?.name) setModelName(found.name);
      })
      .catch(() => {
        // Jobs stay readable without display names.
      });
    return () => {
      cancelled = true;
    };
  }, [job.provider, job.model]);

  const togglePrompt = async (): Promise<void> => {
    const next = !showPrompt;
    setShowPrompt(next);
    if (next && prompt === null) {
      setPromptError(null);
      try {
        setPrompt((await api.jobPrompt(job.id)).promptSnapshot);
      } catch (err) {
        setPromptError(friendlyError(err));
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
        <span className="hint" title={modelName ? `${job.provider}/${job.model}` : undefined}>
          {job.provider ? `${job.provider}/` : ""}
          {modelName ? `${modelName} (${job.model})` : job.model}
        </span>
        <span className="sp" />
        {job.usage ? (
          <span className="hint">
            {formatTokens(job.usage.inputTokens)} in · {formatTokens(job.usage.outputTokens)} out ·{" "}
            {formatCacheRate(job.cacheHitRate)} hit · {formatTokens(job.usage.cachedWriteTokens ?? 0)} written
          </span>
        ) : (
          <span className="hint">no token counts yet</span>
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
      {diagramErrors.map((detail, i) => (
        <div className="frow" style={{ gap: 8 }} key={i}>
          <span className="hint">Diagram: {detail}</span>
        </div>
      ))}
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

/**
 * Raw diagram failure reasons for one job's card or answer (issue
 * #130): reader-facing diagram text stays plain, so the compiler message
 * surfaces here on the Debug page instead. Empty when the snapshot is
 * not loaded or nothing failed.
 */
function diagramErrorsFor(snapshot: ReviewSnapshot | null, job: Job): string[] {
  if (!snapshot) return [];
  const out: string[] = [];
  const walk = (blocks: Block[]): void => {
    for (const b of blocks) {
      if (b.type === "diagram") {
        if (b.render?.status === "error" && b.render.error) out.push(b.render.error);
      } else if (b.type === "aside") {
        walk(b.inner);
      }
    }
  };
  if (job.cardId) {
    for (const page of snapshot.pages) {
      for (const card of page.cards) {
        if (card.id === job.cardId) walk(card.blocks);
      }
    }
  }
  if (job.annotationId) {
    const found = snapshot.annotations.find((a) => a.id === job.annotationId) as unknown as
      | { turns?: { blocks: Block[] }[] }
      | undefined;
    for (const turn of found?.turns ?? []) walk(turn.blocks);
  }
  return out;
}
