/** Per-review folder helper: `<dataDir>/reviews/<owner>/<repo>/<review-id>/`. */
import fs from "node:fs";
import path from "node:path";

export function reviewDir(
  dataDir: string,
  owner: string,
  repo: string,
  reviewId: string,
): string {
  return path.join(dataDir, "reviews", owner, repo, reviewId);
}

/** Ensure the folder exists and return it. */
export function ensureReviewDir(
  dataDir: string,
  owner: string,
  repo: string,
  reviewId: string,
): string {
  const dir = reviewDir(dataDir, owner, repo, reviewId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbFilePath(dataDir: string): string {
  return path.join(dataDir, "unvibe.db");
}
