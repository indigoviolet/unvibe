/**
 * Shared-context observability (PRD §4.14 "Shared context", §9.4).
 *
 * Per-base stats — size, appended tokens, superseded ratio, last rebuild
 * reason, last use, cache-hit rate — persisted per review in SQLite
 * (lazily-created table, so this never conflicts with review-state
 * migrations) and rendered into the shared-context debug document
 * (`GET /api/reviews/:id/shared-context`) so the debug page can show them.
 */
import type { SharedContextBaseStats } from "@unvibe/shared";
import type { DatabaseSync } from "../store/db.js";

export interface BaseObservation {
  reviewId: string;
  baseKey: string;
  baseTokens: number;
  appendedTokens: number;
  supersededTokens: number;
  lastRebuildReason: string | null;
  lastUsedAt: number;
  cacheHitRate?: number;
}

export function toStats(obs: BaseObservation): SharedContextBaseStats {
  return {
    baseKey: obs.baseKey,
    baseTokens: obs.baseTokens,
    appendedTokens: obs.appendedTokens,
    supersededRatio: obs.baseTokens > 0 ? obs.supersededTokens / obs.baseTokens : 0,
    lastRebuildReason: obs.lastRebuildReason,
    ...(obs.cacheHitRate !== undefined ? { cacheHitRate: obs.cacheHitRate } : {}),
    lastUsedAt: obs.lastUsedAt,
  };
}

export class SharedContextStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS sharedctx_bases (
         review_id TEXT NOT NULL,
         base_key TEXT NOT NULL,
         data TEXT NOT NULL DEFAULT '{}',
         PRIMARY KEY (review_id, base_key)
       )`,
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS sharedctx_cursors (
         conversation_key TEXT PRIMARY KEY,
         last_seen_seq INTEGER NOT NULL DEFAULT 0,
         card_id TEXT,
         hunk_hash TEXT,
         updated_at INTEGER NOT NULL DEFAULT 0
       )`,
    );
  }

  observe(obs: BaseObservation): void {
    this.db
      .prepare(
        `INSERT INTO sharedctx_bases (review_id, base_key, data) VALUES (?, ?, ?)
         ON CONFLICT(review_id, base_key) DO UPDATE SET data = excluded.data`,
      )
      .run(obs.reviewId, obs.baseKey, JSON.stringify(obs));
  }

  statsForReview(reviewId: string): SharedContextBaseStats[] {
    const rows = this.db
      .prepare("SELECT data FROM sharedctx_bases WHERE review_id = ? ORDER BY base_key")
      .all(reviewId) as { data: string }[];
    return rows.map((r) => toStats(JSON.parse(r.data) as BaseObservation));
  }

  removeBase(reviewId: string, baseKey: string): void {
    this.db.prepare("DELETE FROM sharedctx_bases WHERE review_id = ? AND base_key = ?").run(reviewId, baseKey);
  }

  /** Conversation cursor: last log seq the conversation has seen. */
  getCursor(conversationKey: string): { lastSeenSeq: number; cardId?: string; hunkHash?: string } {
    const row = this.db
      .prepare("SELECT last_seen_seq, card_id, hunk_hash FROM sharedctx_cursors WHERE conversation_key = ?")
      .get(conversationKey) as { last_seen_seq: number; card_id: string | null; hunk_hash: string | null } | undefined;
    if (!row) return { lastSeenSeq: 0 };
    return {
      lastSeenSeq: row.last_seen_seq,
      ...(row.card_id ? { cardId: row.card_id } : {}),
      ...(row.hunk_hash ? { hunkHash: row.hunk_hash } : {}),
    };
  }

  /**
   * Advance a cursor; never moves backwards. Returns true when it moved.
   * Call only when the turn succeeded — a failed turn must not advance.
   */
  advanceCursor(
    conversationKey: string,
    seq: number,
    opts: { cardId?: string; hunkHash?: string; now?: number } = {},
  ): boolean {
    const cur = this.getCursor(conversationKey);
    if (seq <= cur.lastSeenSeq) return false;
    this.db
      .prepare(
        `INSERT INTO sharedctx_cursors (conversation_key, last_seen_seq, card_id, hunk_hash, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(conversation_key) DO UPDATE SET
           last_seen_seq = excluded.last_seen_seq,
           card_id = excluded.card_id,
           hunk_hash = excluded.hunk_hash,
           updated_at = excluded.updated_at`,
      )
      .run(
        conversationKey,
        seq,
        opts.cardId ?? cur.cardId ?? null,
        opts.hunkHash ?? cur.hunkHash ?? null,
        opts.now ?? Date.now(),
      );
    return true;
  }

  /** Seed a cursor without moving it backwards (new conversations start here). */
  seedCursor(
    conversationKey: string,
    seq: number,
    opts: { cardId?: string; hunkHash?: string; now?: number } = {},
  ): void {
    const cur = this.getCursor(conversationKey);
    if (cur.lastSeenSeq > 0 || cur.cardId !== undefined || cur.hunkHash !== undefined) return;
    this.db
      .prepare(
        `INSERT INTO sharedctx_cursors (conversation_key, last_seen_seq, card_id, hunk_hash, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(conversation_key) DO NOTHING`,
      )
      .run(conversationKey, seq, opts.cardId ?? null, opts.hunkHash ?? null, opts.now ?? Date.now());
  }
}
