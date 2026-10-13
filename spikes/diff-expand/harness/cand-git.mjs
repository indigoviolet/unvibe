// Candidate 3: git's own function context (`git diff -W`). Two variants:
//  - "default": what git does with no .gitattributes in the reviewed repo
//  - "userdiff": the built-in language patterns, switched on from OUTSIDE the repo with
//    `-c core.attributesFile=<file>` (no change to the reviewed repo needed)
// One level only: the range of the -W hunk that contains the change.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const ATTRS = "*.py diff=python\n*.go diff=golang\n*.rs diff=rust\n*.java diff=java\n*.rb diff=ruby\n";
function make(variant) {
  return {
    name: `git -W ${variant}`,
    async init() {},
    async chain(_lang, path, source, a, b, oldSource) {
      const dir = mkdtempSync(join(tmpdir(), "gitw-"));
      try {
        mkdirSync(join(dir, "old")); mkdirSync(join(dir, "new"));
        const f = basename(path);
        writeFileSync(join(dir, "old", f), oldSource);
        writeFileSync(join(dir, "new", f), source);
        writeFileSync(join(dir, "attrs"), ATTRS);
        const args = [];
        if (variant === "userdiff") args.push("-c", `core.attributesFile=${join(dir, "attrs")}`);
        args.push("diff", "--no-index", "--no-color", "-W", "-U0", join("old", f), join("new", f));
        let out = "";
        try { out = execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 1 << 30, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }); }
        catch (e) { out = e.stdout ?? ""; } // exit code 1 = files differ
        const lines = source.split("\n");
        for (const line of out.split("\n")) {
          const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
          if (!m) continue;
          let start = +m[1], end = start + (m[2] === undefined ? 1 : +m[2]) - 1;
          if (start > a || end < b) continue;
          while (start < end && lines[start - 1].trim() === "") start++;
          while (end > start && lines[end - 1].trim() === "") end--;
          if (start >= a && end <= b) return []; // no expansion happened
          return [{ start, end, kind: "function-context", name: m[3].slice(0, 60) }];
        }
        return [];
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
export const gitDefault = make("default");
export const gitUserdiff = make("userdiff");
