// Lists real hunks from a repo's history so a person can pick corpus cases.
// usage: node list-hunks.mjs <repoDir> <ext,ext> [maxCommits] [pathFilterRegex]
import { execFileSync } from "node:child_process";
const [repo, exts, maxCommits = "200", filter = "."] = process.argv.slice(2);
const extRe = new RegExp(`\\.(${exts.split(",").join("|")})$`);
const filterRe = new RegExp(filter);
const out = execFileSync(
  "git",
  ["-C", repo, "log", "--no-merges", `-n${maxCommits}`, "-p", "-U0", "--format=commit %H", "--no-renames"],
  { encoding: "utf8", maxBuffer: 1 << 30 },
);
let sha = "", path = "";
for (const line of out.split("\n")) {
  if (line.startsWith("commit ")) sha = line.slice(7, 17);
  else if (line.startsWith("+++ ")) path = line.startsWith("+++ b/") ? line.slice(6) : "";
  else if (line.startsWith("@@") && path && extRe.test(path) && filterRe.test(path)) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
    const oldN = m[2] === undefined ? 1 : +m[2], newN = m[4] === undefined ? 1 : +m[4];
    console.log(`${sha} ${path} -${m[1]},${oldN} +${m[3]},${newN} | ${m[5].slice(0, 70)}`);
  }
}
