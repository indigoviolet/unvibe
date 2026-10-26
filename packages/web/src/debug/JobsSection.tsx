/**
 * Jobs section (issue #32, PRD §4.14): running and queued jobs for the
 * review, live through the WebSocket `job` events. Each row shows kind,
 * model/provider, state (backing-off with the retry time), tokens,
 * cache-hit rate, a tool-call count, and one button opening the job's
 * turn-by-turn view (prompt, output, tool calls, usage per turn, #207);
 * cancel for active jobs. A totals row sums tokens and the
 * input-weighted cache-hit rate. Relocated unchanged from Settings to
 * the debug page; the Markdown-only rule covers the shared-context
 * parts, not this table.
 */
import { useCallback, useEffect, useState } from "react";
import type { Block, Job, JobToolCall, JobTurnRecord, ReviewSnapshot } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { connectEvents } from "../api/ws.js";
import {
  formatCacheRate,
  formatDurationMs,
  formatLocalTime,
  formatRetryIn,
  formatTokens,
  isLongRunning,
  jobElapsedMs,
  pooledCacheRate,
  pooledTokens,
  reduceJobs,
  stepDurationMs,
} from "../versions/versionUtils.js";
import { Card } from "../ui/index.js";

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

  // Issue #194: tick once a second while anything is active so live
  // elapsed times and the long-running marker stay current.
  const [now, setNow] = useState(() => Date.now());
  const anyActive = (jobs ?? []).some((j) => j.state === "queued" || j.state === "running" || j.state === "backing-off");
  useEffect(() => {
    if (!anyActive) return () => {};
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyActive]);

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
        <Card variant="plain" style={{ padding: "4px 14px" }}>
          {snapshot?.refreshTimings ? (
            <div style={{ padding: "8px 0" }} data-testid="refresh-steps">
              <div className="frow" style={{ gap: 8 }}>
                <span className="kind">Refresh steps</span>
                <span className="hint">{formatLocalTime(snapshot.refreshTimings.at)}</span>
              </div>
              {[...snapshot.refreshTimings.steps]
                .sort((a, b) => a.startedAt - b.startedAt)
                .map((s, i) => (
                  <div className="frow" style={{ gap: 8 }} key={`${s.label}-${i}`}>
                    <span className="hint">
                      {s.label} · started {formatLocalTime(s.startedAt)} · {formatDurationMs(stepDurationMs(s, now))}
                      {s.finishedAt === undefined ? " · running" : ""}
                    </span>
                  </div>
                ))}
            </div>
          ) : null}
          {jobs.map((j) => (
            <JobRow
              key={j.id}
              job={j}
              now={now}
              longRunning={isLongRunning(j, jobs, now)}
              diagramErrors={diagramErrorsFor(snapshot, j)}
              onCancel={() => void cancel(j.id)}
            />
          ))}
          <div className="frow" style={{ gap: 8, padding: "8px 0" }} data-testid="jobs-totals">
            <span className="hint">
              Totals: {formatTokens(totals.input)} in · {formatTokens(totals.output)} out ·{" "}
              {formatCacheRate(rate)} hit · {formatTokens(totals.read)} read · {formatTokens(totals.written)} written
            </span>
            <span className="sp" />
            <button className="x" type="button" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </Card>
      )}
    </section>
  );
}

function JobRow({
  job,
  now,
  longRunning,
  diagramErrors,
  onCancel,
}: {
  job: Job;
  now: number;
  longRunning: boolean;
  diagramErrors: string[];
  onCancel: () => void;
}): React.JSX.Element {
  const [showTools, setShowTools] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [outputTurns, setOutputTurns] = useState<JobTurnRecord[] | null>(job.turnRecords ?? null);
  const [outputError, setOutputError] = useState<string | null>(null);
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

  const toggleOutput = async (): Promise<void> => {
    const next = !showOutput;
    setShowOutput(next);
    if (next && outputTurns === null) {
      setOutputError(null);
      try {
        setOutputTurns((await api.jobOutput(job.id)).turnRecords);
      } catch {
        // Old jobs (and jobs that have not run a turn yet) have no
        // records: say so in place instead of an error.
        setOutputError("No output recorded for this job yet.");
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
          {job.effort ? ` · effort ${job.effort}` : ""}
        </span>
        <span className="sp" />
        {job.usage ? (
          <span className="hint">
            {formatTokens(job.usage.inputTokens)} in · {formatTokens(job.usage.outputTokens)} out ·{" "}
            {formatCacheRate(job.cacheHitRate)} hit · {formatTokens(job.usage.cachedReadTokens ?? 0)} read ·{" "}
            {formatTokens(job.usage.cachedWriteTokens ?? 0)} written
          </span>
        ) : (
          <span className="hint">no token counts yet</span>
        )}
      </div>
      <div className="frow" style={{ gap: 8 }} data-testid="job-times">
        <span className="hint">
          Queued {formatLocalTime(job.queuedAt)} · Started {formatLocalTime(job.startedAt)} · Finished{" "}
          {formatLocalTime(job.finishedAt)} · Duration {formatDurationMs(jobElapsedMs(job, now))}
        </span>
        {longRunning ? (
          <span className="err" data-testid="long-running">
            Running much longer than usual for {job.kind}
          </span>
        ) : null}
      </div>
      {(job.attemptTimings?.length ?? 0) > 0 ? (
        <div className="frow" style={{ gap: 8 }}>
          <span className="hint">
            {(job.attemptTimings ?? [])
              .map(
                (a) =>
                  `Attempt ${a.attempt}: ${formatLocalTime(a.startedAt)} → ${formatLocalTime(a.finishedAt)} (${formatDurationMs(stepDurationMs(a, now))})`,
              )
              .join(" · ")}
          </span>
        </div>
      ) : null}
      {(job.turns?.length ?? 0) > 0 ? (
        <div className="frow" style={{ gap: 8 }}>
          <span className="hint">
            {(job.turns ?? [])
              .map((t) => `${t.label}: started ${formatLocalTime(t.startedAt)} · ${formatDurationMs(stepDurationMs(t, now))}`)
              .join(" · ")}
          </span>
        </div>
      ) : null}
      <div className="frow" style={{ gap: 8 }}>
        {job.progress ? <span className="hint">{job.progress}</span> : null}
        {job.error && job.state !== "backing-off" ? <span className="err">{job.error}</span> : null}
        {job.degradedReason ? <span className="hint">Degraded (answer kept): {job.degradedReason}</span> : null}
        {job.state === "backing-off" && job.error ? <span className="hint">{job.error}</span> : null}
        <span className="sp" />
        <button className="x" type="button" aria-expanded={showOutput} onClick={() => void toggleOutput()}>
          {showOutput ? "Hide output" : "Output"}
        </button>
        {active ? (
          <button className="x" type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      {job.accessMode || (job.tools && job.tools.length > 0) || job.checkoutReset ? (
        <div className="frow" style={{ gap: 8 }}>
          <span className="hint">
            {job.accessMode === "full" ? "Full access" : job.accessMode === "lockdown" ? "Read-only" : ""}
            {job.accessMode && job.checkoutReset ? " · " : ""}
            {job.checkoutReset ? "The checkout changed and was reset after this job" : ""}
          </span>
          <span className="sp" />
          {job.tools && job.tools.length > 0 ? (
            <button
              className="x"
              type="button"
              aria-expanded={showTools}
              onClick={() => setShowTools((v) => !v)}
            >
              Tools: {job.tools.length}
            </button>
          ) : null}
        </div>
      ) : null}
      {showTools && job.tools && job.tools.length > 0 ? (
        <div className="toollist" data-testid="job-tools">
          {job.tools.map((tool, i) => (
            <ToolCallLine key={i} tool={tool} testId="job-tool" />
          ))}
        </div>
      ) : null}
      {diagramErrors.map((detail, i) => (
        <div className="frow" style={{ gap: 8 }} key={i}>
          <span className="hint">Diagram: {detail}</span>
        </div>
      ))}
      {showOutput ? (
        outputError ? (
          <p className="hint">{outputError}</p>
        ) : outputTurns !== null ? (
          <div data-testid="job-output">
            {outputTurns.length === 0 ? (
              <p className="hint">No output recorded for this job yet.</p>
            ) : (
              outputTurns.map((turn, i) => <TurnRecord key={i} turn={turn} index={i} now={now} />)
            )}
          </div>
        ) : (
          <p className="hint">Loading output…</p>
        )
      ) : null}
    </div>
  );
}

/** Short one-line argument summary for a tool-call row (#207). */
function shortToolSummary(detail: string | undefined): string {
  if (!detail) return "";
  const oneLine = detail.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine;
}

/**
 * Issue #207: one tool call as a single line — name, a short truncated
 * argument summary and the start time — expandable to the full
 * arguments and result.
 */
function ToolCallLine({ tool, testId }: { tool: JobToolCall; testId: string }): React.JSX.Element {
  const summary = shortToolSummary(tool.detail);
  return (
    <details className="toolcall" data-testid={testId}>
      <summary>
        <span className="kind">{tool.name}</span>
        {summary ? <span className="hint toolargs">{summary}</span> : null}
        {tool.startedAt !== undefined ? <span className="hint">{formatLocalTime(tool.startedAt)}</span> : null}
      </summary>
      <div className="toolcall-body">
        {tool.startedAt !== undefined ? (
          <p className="hint">
            {formatLocalTime(tool.startedAt)} → {formatLocalTime(tool.finishedAt)}
          </p>
        ) : null}
        <p className="hint">Arguments</p>
        {tool.detail ? <pre className="code">{tool.detail}</pre> : <p className="hint">No arguments recorded.</p>}
        <p className="hint">Result</p>
        {tool.result ? <pre className="code">{tool.result}</pre> : <p className="hint">No result recorded.</p>}
      </div>
    </details>
  );
}

/** Issue #207: one turn of a job's Output view — prompt, streamed output, tool calls, usage. */
function TurnRecord({ turn, index, now }: { turn: JobTurnRecord; index: number; now: number }): React.JSX.Element {
  return (
    <details className="lay" open={index === 0} data-testid="job-turn">
      <summary>
        <span className="kind">
          Reply {index + 1} · {turn.label}
        </span>
        <span className="hint">
          started {formatLocalTime(turn.startedAt)} · {formatDurationMs(stepDurationMs(turn, now))}
          {turn.finishedAt === undefined ? " · running" : ""}
        </span>
        {turn.usage ? (
          <span className="hint">
            {formatTokens(turn.usage.inputTokens)} in · {formatTokens(turn.usage.outputTokens)} out
          </span>
        ) : null}
      </summary>
      <div className="laypad">
        <p className="hint">Prompt</p>
        {turn.prompt ? <pre className="code">{turn.prompt}</pre> : <p className="hint">No prompt recorded for this turn.</p>}
        <p className="hint">Output</p>
        {turn.output ? <pre className="code">{turn.output}</pre> : <p className="hint">No output yet.</p>}
        <p className="hint">Tools</p>
        {turn.tools.length === 0 ? (
          <p className="hint">No tool calls in this turn.</p>
        ) : (
          <div className="toollist" data-testid="job-turn-tools">
            {turn.tools.map((tool, i) => (
              <ToolCallLine key={i} tool={tool} testId="job-turn-tool" />
            ))}
          </div>
        )}
        <p className="hint">Usage</p>
        {turn.usage ? (
          <p className="hint">
            {formatTokens(turn.usage.inputTokens)} in · {formatTokens(turn.usage.cachedReadTokens)} cached read ·{" "}
            {formatTokens(turn.usage.cachedWriteTokens)} cached write · {formatTokens(turn.usage.outputTokens)} out
          </p>
        ) : (
          <p className="hint">No token counts for this turn.</p>
        )}
        {turn.rawUsage !== undefined ? (
          <>
            <p className="hint">Raw usage</p>
            <pre className="code">{JSON.stringify(turn.rawUsage, null, 2)}</pre>
          </>
        ) : null}
      </div>
    </details>
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
      | { replies?: { blocks: Block[] }[] }
      | undefined;
    for (const turn of found?.replies ?? []) walk(turn.blocks);
  }
  return out;
}
