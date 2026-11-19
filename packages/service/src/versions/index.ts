/**
 * Versions milestone (PRD §8): version creation on refresh, hunk-by-hunk
 * comparison, anchor remapping, and the manual update pass.
 *
 * - `compare.ts` / `anchors.ts` / `citations.ts` are pure (no git/store).
 * - `files.ts` persists per-version diffs (migration 003) for carry-over
 *   and changed-hunk detection (the explain-since-X `{ version }` baseline).
 * - `refresh.ts` orchestrates fetch + compare + one-mutate state updates.
 * - `explain.ts` enqueues the agent explain-since-X pass on the job queue
 *   behind the narrow `ExplainBaseRunner` / `ExplainReplyParser`
 *   interfaces (the base-building pipeline is another agent's; tests
 *   inject fakes).
 *
 * Seam left open: uncommitted local edits as an extra version (PRD §8 last
 * line). A future dirty-worktree version can reuse `compareHunks` with
 * `git diff HEAD` as the new diff.
 */
export * from "./compare.js";
export * from "./anchors.js";
export * from "./citations.js";
export * from "./files.js";
export * from "./refresh.js";
export * from "./explain.js";
