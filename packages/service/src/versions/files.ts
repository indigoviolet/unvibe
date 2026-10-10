/**
 * Per-version diff persistence (M5: older versions stay viewable).
 *
 * The live snapshot keeps the current version's `files`; this table keeps
 * every version's `ReviewFile[]` so `GET /api/reviews/:id?version=n` can
 * serve them. Migration 003 creates the table.
 */
import type { ReviewFile } from "@unvibe/shared";
import type { DatabaseSync } from "../store/index.js";

export function saveVersionFiles(
  db: DatabaseSync,
  reviewId: string,
  n: number,
  files: ReviewFile[],
): void {
  db.prepare(
    "INSERT INTO review_version_files (review_id, n, files_json) VALUES (?, ?, ?) " +
      "ON CONFLICT(review_id, n) DO UPDATE SET files_json = excluded.files_json",
  ).run(reviewId, n, JSON.stringify(files));
}

export function loadVersionFiles(
  db: DatabaseSync,
  reviewId: string,
  n: number,
): ReviewFile[] | null {
  const row = db
    .prepare("SELECT files_json AS json FROM review_version_files WHERE review_id = ? AND n = ?")
    .get(reviewId, n) as { json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.json) as ReviewFile[];
}

export function listVersionNumbers(db: DatabaseSync, reviewId: string): number[] {
  const rows = db
    .prepare("SELECT n FROM review_version_files WHERE review_id = ? ORDER BY n")
    .all(reviewId) as { n: number }[];
  return rows.map((r) => r.n);
}
