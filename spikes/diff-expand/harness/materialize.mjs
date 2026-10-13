// Turns a corpus case (repo, sha, path, changed new-side range) into two texts:
// `new` = the file at that commit, `old` = the same file with ONLY that hunk reverted,
// so every candidate sees a diff with exactly one hunk.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const WORK = process.env.SPIKE_WORK || "/tmp/diffexpand-spike";
const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 30 });

export function repoDir(repo) {
  if (repo === "unvibe") return process.env.UNVIBE_REPO || join(import.meta.dirname, "..", "..", "..");
  return join(WORK, "repos", repo);
}

export function materialize(c) {
  if (c.repo === "file") {
    // Synthetic change on a real file: the "old" side is the file with the range's first line blanked.
    const text = readFileSync(join(WORK, "files", c.path), "utf8");
    const lines = text.split("\n");
    const old = lines.slice();
    old[c.a - 1] = old[c.a - 1].replace(/\S.*$/, (m) => m.slice(0, Math.max(1, m.length - 1)));
    return { newText: text, oldText: old.join("\n") };
  }
  const dir = repoDir(c.repo);
  if (!existsSync(dir)) throw new Error(`missing repo ${dir}; run fetch-corpus.mjs`);
  const newText = git(dir, ["show", `${c.sha}:${c.path}`]);
  const diff = git(dir, ["diff", "-U0", "--no-renames", `${c.sha}^`, c.sha, "--", c.path]);
  const lines = diff.split("\n");
  let oldLines = null, found = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
    if (!m) continue;
    const newStart = +m[3], newN = m[4] === undefined ? 1 : +m[4];
    const lo = newN === 0 ? newStart : newStart, hi = newN === 0 ? newStart : newStart + newN - 1;
    if (c.a >= lo && c.a <= hi) {
      oldLines = [];
      for (let j = i + 1; j < lines.length && !lines[j].startsWith("@@"); j++) {
        if (lines[j].startsWith("-")) oldLines.push(lines[j].slice(1));
      }
      found = { newStart, newN };
      break;
    }
  }
  if (!found) throw new Error(`${c.id}: no hunk at +${c.a} in ${c.sha}:${c.path}`);
  const nl = newText.split("\n");
  const head = found.newN === 0 ? nl.slice(0, found.newStart) : nl.slice(0, found.newStart - 1);
  const tail = found.newN === 0 ? nl.slice(found.newStart) : nl.slice(found.newStart - 1 + found.newN);
  return { newText, oldText: [...head, ...oldLines, ...tail].join("\n"), hunk: found };
}
