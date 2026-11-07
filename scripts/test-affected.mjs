#!/usr/bin/env node
/*global console process URL */
/**
 * `mise run test:affected` (issue #358): the pre-fold / pre-report check.
 *
 * 1. Prints the changed files since the base (default: merge-base with
 *    `main-rc`; `--base <ref>` overrides) and the extra specs the trigger
 *    table pulls in, with reasons — before running anything.
 * 2. Runs the full fast suite (`mise run check`).
 * 3. Runs the needed builds once (`build`, `demo:build`: the same deps as
 *    `mise run test:e2e`, so `*-service` specs never hit a stale bundle).
 * 4. Runs Playwright on the import-graph-affected specs
 *    (`--only-changed=<base>`, resolved by Playwright itself at runtime).
 * 5. Runs the trigger specs as a separate invocation: positional spec args
 *    AND with `--only-changed`, so they must not share one command line.
 *
 * `--dry-run` prints the choice (changed files, trigger specs + reasons,
 * the exact commands) and runs nothing.
 *
 * Unknown args are forwarded to both Playwright invocations.
 * macOS + Linux: plain node (no shell tricks); git via execFile.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BASE_BRANCH,
  normalizeRel,
  selectTriggerSpecs,
  toRunnerPath,
} from "./test-affected-lib.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB_DIR = path.join(ROOT, "packages", "web");
const E2E_DIR = path.join(WEB_DIR, "e2e");

function git(args, cwd = ROOT) {
  return execFileSync("git", args, { encoding: "utf8", cwd, stdio: "pipe" }).trim();
}

function resolveBase(explicit) {
  if (explicit) return { base: explicit, how: `--base ${explicit}` };
  try {
    const base = git(["merge-base", "HEAD", DEFAULT_BASE_BRANCH]);
    return { base, how: `merge-base HEAD ${DEFAULT_BASE_BRANCH}` };
  } catch {
    throw new Error(
      `test:affected: cannot resolve merge-base with ${DEFAULT_BASE_BRANCH} ` +
        `(missing locally and no origin ref?). Pass an explicit base: ` +
        `mise run test:affected -- --base <ref>`,
    );
  }
}

function changedPaths(base) {
  const out = new Set();
  try {
    const diff = git(["diff", "--name-only", base, "--", "."]);
    for (const line of diff.split("\n")) {
      if (line.trim()) out.add(normalizeRel(line.trim()));
    }
  } catch {
    // Unresolvable base (e.g. shallow): fall through to untracked only.
  }
  try {
    const untracked = git(["ls-files", "--others", "--exclude-standard"]);
    for (const line of untracked.split("\n")) {
      if (line.trim()) out.add(normalizeRel(line.trim()));
    }
  } catch {
    // Ignore: selection just misses untracked files.
  }
  return [...out].sort();
}

function walkSpecs(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walkSpecs(full));
    } else if (entry.endsWith(".spec.ts") && !entry.endsWith(".disabled.spec.ts")) {
      found.push(full);
    }
  }
  return found;
}

function buildCatalog() {
  return walkSpecs(E2E_DIR).map((full) => ({
    file: normalizeRel(path.relative(ROOT, full)),
    text: readFileSync(full, "utf8"),
  }));
}

function run(cmd, args, cwd, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...extraEnv } });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

/**
 * Browser runs go through one throttled core (#363 §6, issue #195):
 * `UNVIBE_E2E_WORKERS=1` serialises the browsers and
 * `UNVIBE_E2E_CPU_THROTTLE=4` slows each page ~4x through CDP, so the
 * affected run catches timing races that only show on slow runners
 * (like the j352 CI race) before they reach CI. Every journey wires
 * `cpuThrottleFromEnv(page)`, so the throttle bites everywhere.
 */
const BROWSER_ENV = {
  UNVIBE_E2E_WORKERS: "1",
  UNVIBE_E2E_CPU_THROTTLE: "4",
};

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const baseIdx = argv.indexOf("--base");
  const explicitBase = baseIdx >= 0 ? argv[baseIdx + 1] : undefined;
  if (baseIdx >= 0 && !explicitBase) {
    console.error("test:affected: --base needs a ref argument");
    process.exit(2);
  }
  const forwarded = argv.filter((a, i) => {
    if (a === "--dry-run") return false;
    if (i === baseIdx || i === baseIdx + 1) return false;
    return true;
  });

  const { base, how } = resolveBase(explicitBase);
  const changed = changedPaths(base);
  const catalog = buildCatalog();
  const triggers = selectTriggerSpecs(changed, catalog);
  const runnerPaths = triggers.map((t) => toRunnerPath(t.file));

  console.log(`test:affected: base ${base} (${how})`);
  console.log(`test:affected: ${changed.length} changed path(s) since base:`);
  for (const p of changed) console.log(`  changed  ${p}`);
  if (changed.length === 0) console.log("  (none: only the import-graph set applies)");
  console.log(`test:affected: ${triggers.length} trigger spec(s):`);
  for (const t of triggers) {
    console.log(`  trigger  ${toRunnerPath(t.file)}`);
    for (const r of t.reasons) console.log(`             why: ${r}`);
  }
  if (triggers.length === 0) console.log("  (none)");
  console.log(
    "test:affected: import-graph specs resolve at runtime via " +
      `playwright test --only-changed=${base}`,
  );

  if (dryRun) {
    console.log("test:affected: --dry-run, running nothing. Would run, in order:");
    console.log("  mise run check");
    console.log("  mise run build && mise run demo:build");
    console.log(
      "  browser runs use UNVIBE_E2E_WORKERS=1 UNVIBE_E2E_CPU_THROTTLE=4 (one throttled core, #363 §6)",
    );
    console.log(
      `  [packages/web] UNVIBE_E2E_WORKERS=1 UNVIBE_E2E_CPU_THROTTLE=4 npx playwright test --only-changed=${base}` +
        (forwarded.length > 0 ? ` ${forwarded.join(" ")}` : ""),
    );
    if (runnerPaths.length > 0) {
      console.log(
        `  [packages/web] UNVIBE_E2E_WORKERS=1 UNVIBE_E2E_CPU_THROTTLE=4 npx playwright test ${runnerPaths.join(" ")}` +
          (forwarded.length > 0 ? ` ${forwarded.join(" ")}` : ""),
      );
    }
    return 0;
  }

  let code = run("mise", ["run", "check"], ROOT);
  if (code !== 0) return code;
  code = run("mise", ["run", "build"], ROOT);
  if (code !== 0) return code;
  code = run("mise", ["run", "demo:build"], ROOT);
  if (code !== 0) return code;
  code = run("npx", ["playwright", "test", `--only-changed=${base}`, ...forwarded], WEB_DIR, BROWSER_ENV);
  if (code !== 0) return code;
  if (runnerPaths.length > 0) {
    code = run("npx", ["playwright", "test", ...runnerPaths, ...forwarded], WEB_DIR, BROWSER_ENV);
    if (code !== 0) return code;
  } else {
    console.log("test:affected: no trigger specs, skipping the second invocation.");
  }
  return 0;
}

process.exit(main());
