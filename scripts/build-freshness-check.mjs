/*global console process */
// Build freshness check (issue #64): a change under any package's `src`
// must rebuild that package even when another package's `dist` is newer,
// and a clean tree must skip.
//
// Procedure (repo root, content is never modified — only mtimes):
//   1. `mise run build` twice: first ensures everything is built, second
//      must skip all three per-package tasks.
//   2. Touch `packages/web/src/App.tsx`, then rebuild shared the way
//      `mise run check` does (`npm run build --workspace @unvibe/shared`,
//      so `packages/shared/dist/index.js` is the newest output).
//   3. `mise run build` must NOT skip `build:web` (its source changed) or
//      `build:service` (its `packages/shared/dist/index.js` source
//      changed), while `build:shared` still skips (its own sources did
//      not change) — the per-package granularity that the old single
//      mixed-outputs task could not express.
//   4. `mise run build` again must skip everything (tree left fresh).
//
// Usage: `mise run build-freshness`. Too slow for `check` (two real
// builds, ~1 min); run it and CI-style gates directly.
import { spawnSync } from "node:child_process";
import { utimesSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_SRC = path.join(ROOT, "packages", "web", "src", "App.tsx");
const SKIP = "sources up-to-date, skipping";

function run(cmd, args, timeoutMs = 600_000) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout: timeoutMs });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`ok: ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  }
}

// 1. Baseline: build, then everything must skip.
{
  const first = run("mise", ["run", "build"]);
  assert(first.status === 0, `initial mise run build exits 0 (got ${first.status})`);
  if (first.status !== 0) {
    console.error(first.out.slice(-3000));
    process.exit(1);
  }
  const second = run("mise", ["run", "build"]);
  assert(second.status === 0, "second mise run build exits 0");
  for (const t of ["build:shared", "build:service", "build:web"]) {
    assert(second.out.includes(`[${t}] ${SKIP}`), `no change: ${t} skips`);
  }
}

// 2. Web source touched, shared rebuilt (the `check` sequence from #64).
{
  const now = new Date();
  utimesSync(WEB_SRC, now, now);
  const shared = run("npm", ["run", "build", "--workspace", "@unvibe/shared"]);
  assert(shared.status === 0, "rebuild of @unvibe/shared exits 0");
}

// 3. Build must not skip the stale packages — but must still skip shared.
{
  const b = run("mise", ["run", "build"]);
  assert(b.status === 0, "mise run build after web touch + shared rebuild exits 0");
  assert(b.out.includes(`[build:shared] ${SKIP}`), "shared (unchanged) still skips");
  assert(!b.out.includes(`[build:web] ${SKIP}`), "web (source touched) does NOT skip");
  assert(!b.out.includes(`[build:service] ${SKIP}`), "service (shared dist changed) does NOT skip");
  if (failures > 0) console.error(b.out.slice(-3000));
}

// 4. Tree left fresh: everything skips again.
{
  const b = run("mise", ["run", "build"]);
  assert(b.status === 0, "final mise run build exits 0");
  for (const t of ["build:shared", "build:service", "build:web"]) {
    assert(b.out.includes(`[${t}] ${SKIP}`), `final: ${t} skips`);
  }
}

if (failures > 0) {
  console.error(`build-freshness: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("build-freshness: all green");
