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
}): Repo {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    localPath: row.local_path,
    lastOpened: row.last_opened,
  };
}

export class RepoStore {
  constructor(private readonly db: DatabaseSync) {}

  /** Remembered repos, most recently opened first. */
  list(): Repo[] {
    const rows = this.db
      .prepare("SELECT id, owner, name, local_path, last_opened FROM repos ORDER BY last_opened DESC")
      .all() as Parameters<typeof rowToRepo>[0][];
    return rows.map(rowToRepo);
  }

  get(id: string): Repo | null {
    const row = this.db
      .prepare("SELECT id, owner, name, local_path, last_opened FROM repos WHERE id = ?")
      .get(id) as Parameters<typeof rowToRepo>[0] | undefined;
    return row ? rowToRepo(row) : null;
  }

  getByPath(localPath: string): Repo | null {
    const row = this.db
      .prepare("SELECT id, owner, name, local_path, last_opened FROM repos WHERE local_path = ?")
      .get(localPath) as Parameters<typeof rowToRepo>[0] | undefined;
    return row ? rowToRepo(row) : null;
  }

  /** Insert or update by absolute path (path identity is stable). */
  upsert(repo: Repo): Repo {
    this.db
      .prepare(
        "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, name = excluded.name, " +
          "local_path = excluded.local_path, last_opened = excluded.last_opened",
      )
      .run(repo.id, repo.owner, repo.name, repo.localPath, repo.lastOpened);
    return repo;
  }

  /** Mark a repo opened now (start-page recency). */
  touch(id: string): void {
    this.db.prepare("UPDATE repos SET last_opened = ? WHERE id = ?").run(Date.now(), id);
  }
}
