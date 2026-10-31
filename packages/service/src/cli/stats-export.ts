/**
 * `unvibe stats export` (issue #323): write the anonymized stats export
 * to a local file. Read-only on the data dir (the DB is opened
 * read-only; a missing DB yields an empty export). No upload, ever.
 */
import fs from "node:fs";
import path from "node:path";
import { buildStatsExport, buildStatsExportFromDb } from "../stats/export.js";
import { dbFilePath, openDatabaseReadOnly } from "../store/index.js";

export const STATS_USAGE = [
  "Usage: unvibe stats export [--out <file>]",
  "",
  "Write an anonymized usage-statistics file (numbers, enums and salted",
  "hashes only — see docs/stats-export.md). Default: ./unvibe-stats.json",
].join("\n");

export function runStatsExport(opts: { dataDir: string; out?: string; cwd?: string }): {
  path: string;
  reviews: number;
  jobs: number;
} {
  const out = opts.out ?? path.join(opts.cwd ?? process.cwd(), "unvibe-stats.json");
  const dbPath = dbFilePath(opts.dataDir);
  let body;
  if (fs.existsSync(dbPath)) {
    const db = openDatabaseReadOnly(dbPath);
    try {
      body = buildStatsExportFromDb(db);
    } finally {
      db.close();
    }
  } else {
    body = buildStatsExport([], []);
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return { path: path.resolve(out), reviews: body.totals.reviews, jobs: body.totals.jobs };
}

export function parseStatsExportOut(args: string[]): { out?: string } | { error: string } {
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") {
      const v = args[i + 1];
      if (!v || v.startsWith("-")) return { error: "--out needs a file path" };
      out = v;
      i++;
    } else {
      return { error: `unknown argument: ${args[i]}` };
    }
  }
  return out ? { out } : {};
}
