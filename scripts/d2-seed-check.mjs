/*global console process */
 // D2 seed determinism check, run as:
 //   node scripts/d2-seed-check.mjs [--strict]
 //
 // Bundles `scripts/d2-seed-check.probe.ts` (same esbuild pattern as the
 // `fixture-snapshot` task) and runs it: re-renders every pre-rendered
 // fixture diagram with the real `d2` and compares bytes. Skips visibly
 // when `d2` is absent (`mise install d2`). `--strict` exits nonzero on
 // any mismatch; without it the verdict is printed but always exits 0.
 // CI runs strict on Linux and report-only on macOS (see DEVELOPMENT.md).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRunRoot, removeDir } from "./tmp-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const tmpDir = createRunRoot("unvibe-d2-seed-check-");
const bundle = path.join(tmpDir, "probe.mjs");
const esbuild = spawnSync(
  "npx",
  [
    "esbuild",
    path.join(ROOT, "scripts", "d2-seed-check.probe.ts"),
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node24",
    `--outfile=${bundle}`,
    "--log-level=warning",
  ],
  { cwd: ROOT, encoding: "utf8", timeout: 300_000 },
);
if (esbuild.status !== 0) {
  console.error(`d2-seed-check: esbuild failed\n${esbuild.stdout ?? ""}\n${esbuild.stderr ?? ""}`);
  removeDir(tmpDir);
  process.exit(1);
}
const run = spawnSync(process.execPath, [bundle, "--root", ROOT, ...process.argv.slice(2)], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 600_000,
});
process.stdout.write(run.stdout ?? "");
process.stderr.write(run.stderr ?? "");
removeDir(tmpDir);
process.exit(run.status ?? 1);
