/**
 * Post-job checkout check (issue #160, cheap check 1).
 *
 * Applies only when full access is on: after each job, check the review's
 * worktree against the reviewed commit and reset it when anything changed
 * (`git reset --hard <head>` + `git clean -fd`), so a later job never
 * reads a modified tree. The reset is recorded on the job
 * (`job.checkoutReset`), which the Debug page shows. The job itself is
 * never failed for this: its results still stand; the flag says the tree
 * was dirty.
 *
 * This makes violations visible, it does not prevent them — and it only
 * runs when full access is on. Under the lock-down the checkout cannot
 * change, so the check is skipped entirely (no behaviour change there).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { Job } from "@unvibe/shared";
import { accessModeOf } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";
import type { ReviewStore } from "../state/store.js";
import type { SettingsStore } from "../settings/index.js";
import { reportError } from "../telemetry/sentry.js";

export interface VerifyCheckoutDeps {
  reviews: ReviewStore;
  commands: CommandRunner;
  settings: SettingsStore;
  dataDir: string;
}

export function worktreeFor(dataDir: string, reviewId: string): string {
  return path.join(dataDir, "worktrees", reviewId);
}

/**
 * Verify one review's checkout after a job; reset + flag the job when
 * dirty. Best-effort: never throws, never fails the job.
 */
export async function verifyCheckoutAfterJob(
  deps: VerifyCheckoutDeps,
  reviewId: string,
  job: Job,
): Promise<void> {
  try {
    await verifyCheckoutAfterJobInner(deps, reviewId, job);
  } catch (err) {
    reportError(err, { reviewId, jobId: job.id, hook: "verifyCheckout" });
  }
}

async function verifyCheckoutAfterJobInner(
  deps: VerifyCheckoutDeps,
  reviewId: string,
  job: Job,
): Promise<void> {
  // Lock-down sessions cannot change the checkout: skip entirely.
  if (accessModeOf(deps.settings.get()) !== "full") return;
  const snapshot = deps.reviews.getSnapshot(reviewId);
  if (!snapshot) return;
  const headSha = snapshot.version.headSha;
  if (!headSha) return;
  const cwd = worktreeFor(deps.dataDir, reviewId);
  // The demo and fresh reviews may have no worktree: nothing to check.
  if (!existsSync(cwd)) return;

  const status = await deps.commands.run("git", { args: ["-C", cwd, "status", "--porcelain=v1", "-uall"] });
  const head = await deps.commands.run("git", { args: ["-C", cwd, "rev-parse", "HEAD"] });
  const dirty = status.stdout.trim() !== "" || head.stdout.trim() !== headSha;
  if (!dirty) return;

  await deps.commands.run("git", { args: ["-C", cwd, "reset", "--hard", headSha] });
  await deps.commands.run("git", { args: ["-C", cwd, "clean", "-fdq"] });
  job.checkoutReset = true;
}
