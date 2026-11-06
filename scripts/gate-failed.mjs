#!/usr/bin/env node
/*global console process URL */
/**
 * `mise run gate:failed` (issue #358): re-run only what failed.
 *
 * Playwright records failing tests in
 * `packages/web/test-results/.last-run.json` after every run, so
 * `playwright test --last-failed` re-runs exactly those specs.
 *
 * Vitest keeps no such state (no cache, no reporter file is configured),
 * so failed vitest files cannot be recovered cleanly: this task says so
 * and stays Playwright-only. Re-run failed vitest files by name, e.g.
 * `cd packages/service && npx vitest run test/reviews.test.ts`.
 *
 * `--dry-run` prints what would run without running anything.
 * `--last-failed-file <path>` overrides the default last-run file.
 * Other unknown args are forwarded to Playwright.
 * macOS + Linux: plain node (no shell tricks).
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB_DIR = path.join(ROOT, "packages", "web");
const DEFAULT_LAST_RUN = path.join(WEB_DIR, "test-results", ".last-run.json");

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const lffIdx = argv.indexOf("--last-failed-file");
  const lastRunFile = lffIdx >= 0 ? argv[lffIdx + 1] : DEFAULT_LAST_RUN;
  if (lffIdx >= 0 && !argv[lffIdx + 1]) {
    console.error("gate:failed: --last-failed-file needs a path argument");
    process.exit(2);
  }
  const forwarded = argv.filter((a, i) => {
    if (a === "--dry-run") return false;
    if (i === lffIdx || i === lffIdx + 1) return false;
    return true;
  });

  let failed = null;
  if (existsSync(lastRunFile)) {
    try {
      const info = JSON.parse(readFileSync(lastRunFile, "utf8"));
      failed = Array.isArray(info.failedTests) ? info.failedTests : null;
    } catch {
      failed = null;
    }
  }

  if (failed === null) {
    console.log(
      `gate:failed: no usable last-run record at ${lastRunFile} ` +
        `(run the suite once first; --last-failed-file <path> overrides).`,
    );
    console.log(
      "gate:failed: vitest keeps no last-failed state: re-run failed vitest " +
        "files by name, e.g. cd packages/service && npx vitest run test/<file>.test.ts.",
    );
    return 0;
  }
  console.log(`gate:failed: ${failed.length} failed test(s) on record.`);
  if (failed.length === 0) {
    console.log("gate:failed: last run was green, nothing to re-run.");
    return 0;
  }
  for (const t of failed.slice(0, 20)) console.log(`  failed  ${t}`);
  if (failed.length > 20) console.log(`  ... and ${failed.length - 20} more`);

  const args = ["playwright", "test", "--last-failed", ...forwarded];
  if (lastRunFile !== DEFAULT_LAST_RUN) {
    args.push(`--last-failed-file=${lastRunFile}`);
  }
  console.log(`gate:failed: running [packages/web] npx ${args.join(" ")}`);
  if (dryRun) {
    console.log("gate:failed: --dry-run, running nothing.");
    return 0;
  }
  const r = spawnSync("npx", args, { cwd: WEB_DIR, stdio: "inherit" });
  if (r.error) throw r.error;
  const code = r.status ?? 1;
  if (code !== 0) {
    console.log("gate:failed: still red. Fix, re-run `mise run gate:failed`, then ONE final full gate.");
  } else {
    console.log("gate:failed: green. Run ONE final full `mise run gate` before merging (one full run at a time).");
  }
  console.log(
    "gate:failed: note: vitest keeps no last-failed state; re-run failed vitest " +
      "files by name (see above).",
  );
  return code;
}

process.exit(main());
