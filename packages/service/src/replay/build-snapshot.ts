/**
 * CLI: `npm run fixture:snapshot` — build
 * `fixtures/urllib3-5020/snapshot.json` from the recordings. Exits non-zero
 * (and writes nothing) when any citation is unverified.
 *
 * Usage: `node ./dist/replay/build-snapshot.js [--fixtures <dir>] [--out <file>]`
 */
import fs from "node:fs";
import path from "node:path";
import { buildSnapshot, defaultFixturesDir } from "./snapshot.js";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const fixturesDir = path.resolve(arg("--fixtures") ?? defaultFixturesDir(import.meta.url));
const out = path.resolve(arg("--out") ?? path.join(fixturesDir, "snapshot.json"));

try {
  const { snapshot, counts } = buildSnapshot(fixturesDir);
  fs.writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
  const cites = counts.reduce((s, c) => s + c.citations, 0);
  console.log(
    `snapshot: ${snapshot.pages.length} pages, ${snapshot.files.length} files, ` +
      `${counts.length} recordings, ${cites} citations, 0 unverified → ${out}`,
  );
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
