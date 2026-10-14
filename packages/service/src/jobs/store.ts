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
  degradedReason?: string;
  dedupeKey?: string;
  attempts?: number;
  nextRetryAt?: number;
  cardId?: string;
  annotationId?: string;
  /** Issue #160: posture stamp, tool record, checkout-reset flag. */
  accessMode?: Job["accessMode"];
  tools?: Job["tools"];
  checkoutReset?: boolean;
}

export interface JobPersistence {
  save(job: Job): void;
  get(id: string): Job | undefined;
  listByReview(reviewId: string): Job[];
  /** Every non-terminal job (for startup recovery). */
  listOpen(): Job[];
  /** Every stored job, oldest first (startup hydration, issue #117). */
  listAll(): Job[];
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
    ...(data.degradedReason !== undefined ? { degradedReason: data.degradedReason } : {}),
    ...(data.dedupeKey !== undefined ? { dedupeKey: data.dedupeKey } : {}),
    ...(data.attempts !== undefined ? { attempts: data.attempts } : {}),
    ...(data.nextRetryAt !== undefined ? { nextRetryAt: data.nextRetryAt } : {}),
    ...(data.cardId !== undefined ? { cardId: data.cardId } : {}),
    ...(data.annotationId !== undefined ? { annotationId: data.annotationId } : {}),
    ...(data.accessMode !== undefined ? { accessMode: data.accessMode } : {}),
    ...(data.tools !== undefined ? { tools: data.tools } : {}),
    ...(data.checkoutReset !== undefined ? { checkoutReset: data.checkoutReset } : {}),
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
      ...(job.degradedReason !== undefined ? { degradedReason: job.degradedReason } : {}),
      ...(job.dedupeKey !== undefined ? { dedupeKey: job.dedupeKey } : {}),
      ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
      ...(job.nextRetryAt !== undefined ? { nextRetryAt: job.nextRetryAt } : {}),
      ...(job.cardId !== undefined ? { cardId: job.cardId } : {}),
      ...(job.annotationId !== undefined ? { annotationId: job.annotationId } : {}),
      ...(job.accessMode !== undefined ? { accessMode: job.accessMode } : {}),
      ...(job.tools !== undefined ? { tools: job.tools } : {}),
      ...(job.checkoutReset !== undefined ? { checkoutReset: job.checkoutReset } : {}),
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

  listAll(): Job[] {
    const rows = this.db.prepare("SELECT * FROM jobs ORDER BY rowid").all() as Parameters<
      typeof rowToJob
    >[0][];
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
