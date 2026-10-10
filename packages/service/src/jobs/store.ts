/**
 * SQLite persistence for jobs.
 *
 * Uses the scaffold `jobs` table (migration 001) without schema changes:
 * indexed columns mirror the filter fields, everything else lives in the
 * `data` JSON column. The queue writes on every transition so the Jobs
 * view survives a restart (PRD §4.14, §16).
 */
import type { Job, JobState } from "@unvibe/shared";
import type { DatabaseSync } from "../store/db.js";

const TERMINAL: ReadonlySet<JobState> = new Set(["done", "error", "cancelled"]);

interface JobData {
  provider?: string;
  promptSnapshot?: string;
  usage?: Job["usage"];
  cacheHitRate?: number;
  error?: string;
  dedupeKey?: string;
  attempts?: number;
  nextRetryAt?: number;
}

export interface JobPersistence {
  save(job: Job): void;
  get(id: string): Job | undefined;
  listByReview(reviewId: string): Job[];
  /** Every non-terminal job (for startup recovery). */
  listOpen(): Job[];
}

function rowToJob(row: {
  id: string;
  review_id: string | null;
  kind: string;
  model: string;
  priority: number;
  state: string;
  session_id: string | null;
  data: string;
}): Job {
  const data = JSON.parse(row.data) as JobData;
  return {
    id: row.id,
    kind: row.kind as Job["kind"],
    model: row.model,
    ...(data.provider !== undefined ? { provider: data.provider } : {}),
    ...(row.review_id ? { reviewId: row.review_id } : {}),
    priority: row.priority,
    state: row.state as JobState,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(data.promptSnapshot !== undefined ? { promptSnapshot: data.promptSnapshot } : {}),
    ...(data.usage !== undefined ? { usage: data.usage } : {}),
    ...(data.cacheHitRate !== undefined ? { cacheHitRate: data.cacheHitRate } : {}),
    ...(data.error !== undefined ? { error: data.error } : {}),
    ...(data.dedupeKey !== undefined ? { dedupeKey: data.dedupeKey } : {}),
    ...(data.attempts !== undefined ? { attempts: data.attempts } : {}),
    ...(data.nextRetryAt !== undefined ? { nextRetryAt: data.nextRetryAt } : {}),
  };
}

export class JobStore implements JobPersistence {
  constructor(private readonly db: DatabaseSync) {}

  save(job: Job): void {
    const data: JobData = {
      ...(job.provider !== undefined ? { provider: job.provider } : {}),
      ...(job.promptSnapshot !== undefined ? { promptSnapshot: job.promptSnapshot } : {}),
      ...(job.usage !== undefined ? { usage: job.usage } : {}),
      ...(job.cacheHitRate !== undefined ? { cacheHitRate: job.cacheHitRate } : {}),
      ...(job.error !== undefined ? { error: job.error } : {}),
      ...(job.dedupeKey !== undefined ? { dedupeKey: job.dedupeKey } : {}),
      ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
      ...(job.nextRetryAt !== undefined ? { nextRetryAt: job.nextRetryAt } : {}),
    };
    this.db
      .prepare(
        `INSERT INTO jobs (id, review_id, kind, model, priority, state, session_id, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           review_id = excluded.review_id, kind = excluded.kind, model = excluded.model,
           priority = excluded.priority, state = excluded.state,
           session_id = excluded.session_id, data = excluded.data`,
      )
      .run(
        job.id,
        job.reviewId ?? null,
        job.kind,
        job.model,
        job.priority,
        job.state,
        job.sessionId ?? null,
        JSON.stringify(data),
      );
  }

  get(id: string): Job | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
      | Parameters<typeof rowToJob>[0]
      | undefined;
    return row ? rowToJob(row) : undefined;
  }

  listByReview(reviewId: string): Job[] {
    const rows = this.db
      .prepare("SELECT * FROM jobs WHERE review_id = ? ORDER BY rowid")
      .all(reviewId) as Parameters<typeof rowToJob>[0][];
    return rows.map(rowToJob);
  }

  listOpen(): Job[] {
    const states = [...TERMINAL].map((s) => `'${s}'`).join(",");
    const rows = this.db.prepare(`SELECT * FROM jobs WHERE state NOT IN (${states})`).all() as Parameters<
      typeof rowToJob
    >[0][];
    return rows.map(rowToJob);
  }
}
