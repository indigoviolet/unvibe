/**
 * Tiny migration runner + migration 001.
 *
 * Tables cover the §7.1 entities. Nested shapes (blocks, anchors, messages,
 * items, payloads) are JSON columns; owners parse them with the shared types.
 */
import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  name: string;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "001-initial-schema",
    up: `
      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        local_path TEXT NOT NULL,
        last_opened INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL REFERENCES repos(id),
        branch TEXT NOT NULL,
        pr_number INTEGER,
        current_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        data JSON NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS versions (
        review_id TEXT NOT NULL REFERENCES reviews(id),
        n INTEGER NOT NULL,
        head_sha TEXT NOT NULL,
        merge_base_sha TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        id_mapping JSON NOT NULL DEFAULT '{}',
        PRIMARY KEY (review_id, n)
      );
      CREATE TABLE IF NOT EXISTS files (
        review_id TEXT NOT NULL REFERENCES reviews(id),
        version_n INTEGER NOT NULL,
        file_key TEXT NOT NULL,
        path TEXT NOT NULL,
        category TEXT NOT NULL,
        PRIMARY KEY (review_id, version_n, file_key)
      );
      CREATE TABLE IF NOT EXISTS hunks (
        review_id TEXT NOT NULL REFERENCES reviews(id),
        version_n INTEGER NOT NULL,
        file_key TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        header TEXT NOT NULL,
        new_start INTEGER NOT NULL,
        new_end INTEGER NOT NULL,
        old_start INTEGER NOT NULL,
        old_end INTEGER NOT NULL,
        added INTEGER NOT NULL,
        removed INTEGER NOT NULL,
        hidden_reason TEXT,
        PRIMARY KEY (review_id, version_n, file_key, content_hash)
      );
      CREATE TABLE IF NOT EXISTS hunk_states (
        review_id TEXT NOT NULL REFERENCES reviews(id),
        content_hash TEXT NOT NULL,
        folded INTEGER NOT NULL DEFAULT 0,
        reviewed INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        note TEXT,
        PRIMARY KEY (review_id, content_hash)
      );
      CREATE TABLE IF NOT EXISTS pages (
        review_id TEXT NOT NULL REFERENCES reviews(id),
        id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        saved INTEGER NOT NULL DEFAULT 0,
        parent TEXT,
        data JSON NOT NULL DEFAULT '{}',
        PRIMARY KEY (review_id, id)
      );
      CREATE TABLE IF NOT EXISTS cards (
        review_id TEXT NOT NULL REFERENCES reviews(id),
        page_id TEXT NOT NULL,
        id TEXT NOT NULL,
        title TEXT,
        level TEXT NOT NULL DEFAULT 'standard',
        is_read INTEGER NOT NULL DEFAULT 0,
        collapsed INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 1,
        data JSON NOT NULL DEFAULT '{}',
        PRIMARY KEY (review_id, page_id, id)
      );
      CREATE TABLE IF NOT EXISTS blocks (
        review_id TEXT NOT NULL REFERENCES reviews(id),
        card_id TEXT NOT NULL,
        id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        type TEXT NOT NULL,
        data JSON NOT NULL DEFAULT '{}',
        PRIMARY KEY (review_id, card_id, id)
      );
      CREATE TABLE IF NOT EXISTS annotations (
        review_id TEXT NOT NULL REFERENCES reviews(id),
        id TEXT NOT NULL,
        type TEXT NOT NULL,
        anchor JSON NOT NULL DEFAULT '{}',
        open INTEGER NOT NULL DEFAULT 0,
        data JSON NOT NULL DEFAULT '{}',
        PRIMARY KEY (review_id, id)
      );
      CREATE TABLE IF NOT EXISTS contributions (
        review_id TEXT NOT NULL REFERENCES reviews(id),
        id TEXT NOT NULL,
        source_session TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        data JSON NOT NULL DEFAULT '{}',
        PRIMARY KEY (review_id, id)
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        review_id TEXT REFERENCES reviews(id),
        kind TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'queued',
        session_id TEXT,
        data JSON NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS log_entries (
        review_id TEXT REFERENCES reviews(id),
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        payload JSON NOT NULL DEFAULT '{}',
        PRIMARY KEY (review_id, seq)
      );
    `,
  },
  {
    version: 2,
    name: "002-review-snapshots",
    up: `
      -- Durable ReviewStore snapshots (M1 service): one row per review holding
      -- the full ReviewSnapshot JSON plus its monotonic rev. The row is the
      -- source of truth across restarts; WS patches carry baseRev/headRev.
      -- Deliberately no REFERENCES clause: ReviewStore is standalone (other
      -- agents call putSnapshot without touching the reviews table), so the
      -- id link is by convention, not by foreign key.
      CREATE TABLE IF NOT EXISTS review_snapshots (
        review_id TEXT PRIMARY KEY,
        rev INTEGER NOT NULL,
        snapshot JSON NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 3,
    name: "003-version-files",
    up: `
      -- Per-version diff files (M5): older versions stay viewable via
      -- GET /api/reviews/:id?version=n. One row per (review, version)
      -- holding the ReviewFile[] JSON for that version's diff. The live
      -- snapshot keeps the current version's files; this table keeps every
      -- version ever fetched.
      CREATE TABLE IF NOT EXISTS review_version_files (
        review_id TEXT NOT NULL,
        n INTEGER NOT NULL,
        files_json JSON NOT NULL DEFAULT '[]',
        PRIMARY KEY (review_id, n)
      );
    `,
  },
  {
    version: 4,
    name: "004-submit-leases",
    up: `
      -- Submit in-flight leases (hardening): one row per review while a
      -- GitHub review POST is in flight. A crash between the POST and the
      -- local posted-mark would otherwise double-post on retry; the next
      -- submit reconciles the lease against GitHub before posting again.
      -- Payload JSON: { commitId, body, comments: [{threadId,path,line,body}] }.
      CREATE TABLE IF NOT EXISTS submit_leases (
        review_id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        commit_id TEXT NOT NULL,
        payload JSON NOT NULL DEFAULT '{}'
      );
    `,
  },
];

export function currentVersion(db: DatabaseSync): number {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL)",
  );
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as {
    v: number | null;
  };
  return row.v ?? 0;
}

/** Apply pending migrations in order. Returns the versions applied. */
export function migrate(db: DatabaseSync): number[] {
  const at = currentVersion(db);
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= at) continue;
    db.exec(m.up);
    db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
      m.version,
      m.name,
    );
    applied.push(m.version);
  }
  return applied;
}
