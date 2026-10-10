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
  "hunk_states",
  "pages",
  "cards",
  "blocks",
  "annotations",
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

export async function deleteReviewLocal(
  deps: DeleteReviewDeps,
  reviewId: string,
): Promise<{ deleted: boolean; worktreeRemoved: boolean }> {
  const { db, runner, dataDir } = deps;
  const row = (() => {
    try {
      return db
        .prepare("SELECT id, repo_id AS repoId FROM reviews WHERE id = ?")
        .get(reviewId) as { id: string; repoId: string } | undefined;
    } catch {
      return undefined;
    }
  })();
  // Snapshot-only reviews (should not happen now that demo writes a row,
  // but be tolerant): still delete snapshot + worktree.
  const snapshotExists = (() => {
    try {
      const r = db
        .prepare("SELECT review_id FROM review_snapshots WHERE review_id = ?")
        .get(reviewId) as { review_id: string } | undefined;
      return !!r;
    } catch {
      return false;
    }
  })();
  if (!row && !snapshotExists) return { deleted: false, worktreeRemoved: false };

  try {
    deps.cancelJobs?.(reviewId);
  } catch {
    // Best effort: continue with the delete.
  }

  const repoPath = (() => {
    try {
      if (!row) return null;
      const r = db.prepare("SELECT local_path AS p FROM repos WHERE id = ?").get(row.repoId) as
        | { p: string }
        | undefined;
      return r?.p ?? null;
    } catch {
      return null;
    }
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
  // Legacy per-review folders (`<dataDir>/reviews/<owner>/<repo>/<id>/`):
  // remove any that end with the review id (bounded walk, one level).
  try {
    const reviewsRoot = path.join(dataDir, "reviews");
    if (fs.existsSync(reviewsRoot)) {
      // Owner/repo nesting is unknown here; do a shallow two-level scan
      // and remove exact-id leaves. Cheap and never follows the checkout.
      for (const owner of fs.readdirSync(reviewsRoot)) {
        const ownerDir = path.join(reviewsRoot, owner);
        let repos: string[] = [];
        try {
          repos = fs.readdirSync(ownerDir);
        } catch {
          continue;
        }
        for (const repo of repos) {
          const candidate = path.join(ownerDir, repo, reviewId);
          try {
            if (fs.existsSync(candidate)) fs.rmSync(candidate, { recursive: true, force: true });
          } catch {
            // Ignore.
          }
        }
      }
    }
  } catch {
    // Ignore.
  }

  transaction(db, () => {
    for (const table of REVIEW_TABLES) {
      if (!tableExists(db, table)) continue;
      try {
        db.prepare(`DELETE FROM ${table} WHERE review_id = ?`).run(reviewId);
      } catch {
        // A missing column/table in an older test DB: skip.
      }
    }
    // Sessions whose persisted data references this review (best effort;
    // sessions also expire via idle close, so a miss is harmless).
    try {
      if (tableExists(db, "sessions")) {
        const rows = db.prepare("SELECT session_id, data FROM sessions").all() as {
          session_id: string;
          data: string;
        }[];
        for (const r of rows) {
          try {
            if (r.data.includes(reviewId)) db.prepare("DELETE FROM sessions WHERE session_id = ?").run(r.session_id);
          } catch {
            // Ignore per-row.
          }
        }
      }
    } catch {
      // Ignore.
    }
    try {
      db.prepare("DELETE FROM reviews WHERE id = ?").run(reviewId);
    } catch {
      // Ignore.
    }
  });

  return { deleted: true, worktreeRemoved };
}
