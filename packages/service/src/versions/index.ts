/**
 * Versions milestone (PRD §8): version creation on refresh, hunk-by-hunk
 * comparison, anchor remapping, and the manual update pass.
 *
 * - `compare.ts` / `anchors.ts` / `citations.ts` are pure (no git/store).
 * - `rangeDiff.ts` wraps `git range-diff` for display (best effort).
 * - `files.ts` persists per-version diffs (migration 003) so older versions
 *   stay viewable via `GET /api/reviews/:id?version=n`.
 * - `refresh.ts` orchestrates fetch + compare + one-mutate state updates.
 * - `update.ts` enqueues the agent update pass on the job queue behind the
 *   narrow `UpdateBaseRunner` / `UpdateReplyParser` interfaces (the
 *   base-building pipeline is another agent's; tests inject fakes).
 *
 * Seam left open: uncommitted local edits as an extra version (PRD §8 last
 * line). A future dirty-worktree version can reuse `compareHunks` with
 * `git diff HEAD` as the new diff.
 */
export * from "./compare.js";
export * from "./anchors.js";
export * from "./citations.js";
export * from "./rangeDiff.js";
export * from "./files.js";
export * from "./refresh.js";
export * from "./update.js";
