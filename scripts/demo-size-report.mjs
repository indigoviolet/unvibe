/*global console process */
/**
 * Print the static-demo bundle size (issue #334).
 *
 * Usage: `node scripts/demo-size-report.mjs [dir]`
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2] ?? "packages/web/dist-demo";

function walk(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
  );
}

const files = walk(dir);
let total = 0;
const rows = files
  .map((f) => ({ f: path.relative(dir, f), bytes: statSync(f).size }))
  .sort((a, b) => b.bytes - a.bytes);
for (const r of rows) total += r.bytes;
console.log(
  `demo bundle: ${(total / 1024 / 1024).toFixed(2)} MB in ${files.length} files → ${dir}/ (largest: ${rows[0]?.f} ${Math.round((rows[0]?.bytes ?? 0) / 1024)} kB)`,
);
