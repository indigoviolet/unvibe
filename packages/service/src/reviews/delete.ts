/**
 * Delete a review's local data (front screen "Remove").
 *
 * Removes every SQLite row for the review plus the managed worktree
 * (`<dataDir>/worktrees/<id>`) and any per-review folder. Never touches
 * GitHub (no `gh` calls) and never touches the user's checkout except
 * removing the managed worktree (via `git worktree remove` + `rm`).
 */
import fs from "node:fs";
import path from "node:path";
import type { CommandRunner } from "../exec/index.js";
import { transaction, type DatabaseSync } from "../store/index.js";

export interface DeleteReviewDeps {
  db: DatabaseSync;
  runner: CommandRunner;
  dataDir: string;
  cancelJobs?: (reviewId: string) => void;
}

const REVIEW_TABLES = [
  "versions",
  "files",
  "hunks",
  "pages",
  "contributions",
  "jobs",
  "log_entries",
  "review_snapshots",
  "review_version_files",
  "sharedctx_bases",
] as const;

function tableExists(db: DatabaseSync, name: string): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name) as { name: string } | undefined;
    return !!row;
  } catch {
    return false;
  }
}

/** Ids of every stored review, including ones that only have a snapshot row. */
export function listReviewIds(db: DatabaseSync): string[] {
  const ids = new Set<string>();
  for (const [table, column] of [
    ["reviews", "id"],
    ["review_snapshots", "review_id"],
  ] as const) {
    for (const r of db.prepare(`SELECT ${column} AS id FROM ${table}`).all() as { id: string }[]) ids.add(r.id);
  }
  return [...ids];
}

/**
 * Reset data (Settings → Data): empty every review table, so rows that a
 * per-review delete missed go too. Settings and repos are other tables and
 * are not touched.
 */
export function deleteAllReviewRows(db: DatabaseSync): void {
  transaction(db, () => {
    for (const table of [...REVIEW_TABLES, "reviews"]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  });
}

export async function deleteReviewLocal(
  deps: DeleteReviewDeps,
  reviewId: string,
): Promise<{ deleted: boolean; worktreeRemoved: boolean }> {
  const { db, runner, dataDir } = deps;
  const row = db
    .prepare("SELECT id, repo_id AS repoId FROM reviews WHERE id = ?")
    .get(reviewId) as { id: string; repoId: string } | undefined;
  const snapshotRow = db
    .prepare("SELECT review_id FROM review_snapshots WHERE review_id = ?")
    .get(reviewId) as { review_id: string } | undefined;
  const snapshotExists = !!snapshotRow;
  if (!row && !snapshotExists) return { deleted: false, worktreeRemoved: false };

  try {
    deps.cancelJobs?.(reviewId);
  } catch {
    // Best effort: continue with the delete.
  }

  const repoPath = (() => {
    if (!row) return null;
    const r = db.prepare("SELECT local_path AS p FROM repos WHERE id = ?").get(row.repoId) as
      | { p: string }
      | undefined;
    return r?.p ?? null;
  })();

  const wt = path.join(dataDir, "worktrees", reviewId);
  let worktreeRemoved = false;
  // Managed worktree only: `git worktree remove` (best effort, needs the
  // source checkout) then a filesystem remove. Never touches the checkout
  // itself or any remote.
  try {
    if (fs.existsSync(wt)) {
      if (repoPath) {
        try {
          await runner.run("git", { args: ["worktree", "remove", "--force", wt], cwd: repoPath });
        } catch {
          // Fall through to rm.
        }
        try {
          await runner.run("git", { args: ["worktree", "prune"], cwd: repoPath });
        } catch {
          // Ignore.
        }
      }
      fs.rmSync(wt, { recursive: true, force: true });
      worktreeRemoved = true;
    }
  } catch {
    try {
      fs.rmSync(wt, { recursive: true, force: true });
      worktreeRemoved = true;
    } catch {
      // Ignore.
    }
  }
  transaction(db, () => {
    for (const table of REVIEW_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE review_id = ?`).run(reviewId);
    }
    // Sessions table is lazily created: it may legitimately not exist yet.
    // Best effort; sessions also expire via idle close, so a miss is harmless.
    if (tableExists(db, "sessions")) {
      const rows = db.prepare("SELECT session_id, data FROM sessions").all() as {
        session_id: string;
        data: string;
      }[];
      for (const r of rows) {
        if (r.data.includes(reviewId)) db.prepare("DELETE FROM sessions WHERE session_id = ?").run(r.session_id);
      }
    }
    db.prepare("DELETE FROM reviews WHERE id = ?").run(reviewId);
  });

  return { deleted: true, worktreeRemoved };
}
