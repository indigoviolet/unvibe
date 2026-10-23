/**
 * Shared vitest suite options (issue #119): the fast/slow split.
 *
 * - Slow vitest tests are named `*.slow.test.ts(x)`; everything under
 *   `packages/web/e2e/` is slow by location (Playwright, not vitest).
 * - `UNVIBE_TEST_SUITE=fast` runs every test file except slow ones;
 *   `=slow` runs only the slow files (after `mise run build`); unset runs
 *   both (plain `npm run test`).
 * - `*.disabled.test.ts(x)` is excluded from every suite (see
 *   DEVELOPMENT.md "Disabling a test").
 * - Worker and heap caps keep one worktree near 5 GB / 8 busy processes
 *   so parallel checkouts do not starve each other; both are overridable.
 */
import os from "node:os";
import { configDefaults } from "vitest/config";

const SLOW = "**/*.slow.test.{ts,tsx}";
const DISABLED = "**/*.disabled.test.{ts,tsx}";

/** "fast" | "slow"; unset runs both. */
const suite = process.env.UNVIBE_TEST_SUITE;
const cores = os.availableParallelism();
const workers = Number(process.env.UNVIBE_TEST_WORKERS) || Math.min(8, Math.max(1, cores - 1));

export function suiteOptions(include: string[]) {
  return {
    include: suite === "slow" ? [SLOW] : include,
    exclude: [...configDefaults.exclude, DISABLED, ...(suite === "fast" ? [SLOW] : [])],
    passWithNoTests: suite === "slow",
    pool: "forks" as const,
    maxWorkers: workers,
    execArgv: ["--max-old-space-size=1024"],
    testTimeout: suite === "slow" ? 30_000 : 10_000,
    hookTimeout: 10_000,
  };
}
