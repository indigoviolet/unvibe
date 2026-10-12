/**
 * Remembered repos (start page, PRD §4.2 "remembers recent repos").
 *
 * Backed by the `repos` table (migration 001). Detected checkouts (see
 * `detect.ts`) are transient and merged in at read time by the route.
 */
import { randomBytes } from "node:crypto";
import type { Repo } from "@unvibe/shared";
import type { DatabaseSync } from "../store/index.js";

/** New repo ids. Format `rp_<12 hex>` (app-assigned, PRD §7.2). */
export function newRepoId(): string {
  return `rp_${randomBytes(6).toString("hex")}`;
}

function rowToRepo(row: {
  id: string;
  owner: string;
  name: string;
  local_path: string;
  last_opened: number;
  managed?: number | null;
}): Repo {
  const repo: Repo = {
    id: row.id,
    owner: row.owner,
    name: row.name,
    localPath: row.local_path,
    lastOpened: row.last_opened,
  };
  // #27: managed clones only; every app database runs migration 005, so
  // the column exists. The field stays optional on the type (absent/false
  // both mean "the user's own checkout").
  if (row.managed === 1) repo.managed = true;
  return repo;
}

/** Columns read everywhere (managed added in migration 005). */
const REPO_COLS = "id, owner, name, local_path, last_opened, managed";

export class RepoStore {
  constructor(private readonly db: DatabaseSync) {}

  /** Remembered repos, most recently opened first. */
  list(): Repo[] {
    const rows = this.db
      .prepare(`SELECT ${REPO_COLS} FROM repos ORDER BY last_opened DESC`)
      .all() as Parameters<typeof rowToRepo>[0][];
    return rows.map(rowToRepo);
  }

  get(id: string): Repo | null {
    const row = this.db
      .prepare(`SELECT ${REPO_COLS} FROM repos WHERE id = ?`)
      .get(id) as Parameters<typeof rowToRepo>[0] | undefined;
    return row ? rowToRepo(row) : null;
  }

  getByPath(localPath: string): Repo | null {
    const row = this.db
      .prepare(`SELECT ${REPO_COLS} FROM repos WHERE local_path = ?`)
      .get(localPath) as Parameters<typeof rowToRepo>[0] | undefined;
    return row ? rowToRepo(row) : null;
  }

  /** Remembered managed clone for owner/name, if any (#27 reuse). */
  getManaged(owner: string, name: string): Repo | null {
    const row = this.db
      .prepare(`SELECT ${REPO_COLS} FROM repos WHERE owner = ? AND name = ? AND managed = 1`)
      .get(owner, name) as Parameters<typeof rowToRepo>[0] | undefined;
    return row ? rowToRepo(row) : null;
  }

  /**
   * Managed row for owner/name in any casing. The managed directory is
   * lowercase-canonical, but rows written before canonicalisation (or
   * remembered under another spelling) may differ in case only — match
   * them so every spelling reuses one row.
   */
  getManagedAnyCase(owner: string, name: string): Repo | null {
    const row = this.db
      .prepare(
        `SELECT ${REPO_COLS} FROM repos WHERE owner COLLATE NOCASE = ? AND name COLLATE NOCASE = ? AND managed = 1`,
      )
      .get(owner, name) as Parameters<typeof rowToRepo>[0] | undefined;
    return row ? rowToRepo(row) : null;
  }

  /**
   * How many reviews belong to a repo (remove refuses while > 0). Throws
   * on query errors: callers on destructive paths must fail closed, never
   * read an error as "no reviews".
   */
  countReviews(repoId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM reviews WHERE repo_id = ?")
      .get(repoId) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  /** Forget a repo (the row only; clone deletion is the caller's job). */
  remove(id: string): boolean {
    const res = this.db.prepare("DELETE FROM repos WHERE id = ?").run(id) as unknown as {
      changes: number | bigint;
    };
    return Number(res.changes) > 0;
  }

  /** Insert or update by absolute path (path identity is stable). */
  upsert(repo: Repo): Repo {
    this.db
      .prepare(
        "INSERT INTO repos (id, owner, name, local_path, last_opened, managed) VALUES (?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, name = excluded.name, " +
          "local_path = excluded.local_path, last_opened = excluded.last_opened, managed = excluded.managed",
      )
      .run(repo.id, repo.owner, repo.name, repo.localPath, repo.lastOpened, repo.managed === true ? 1 : 0);
    return repo;
  }

  /** Mark a repo opened now (start-page recency). */
  touch(id: string): void {
    this.db.prepare("UPDATE repos SET last_opened = ? WHERE id = ?").run(Date.now(), id);
  }
}
