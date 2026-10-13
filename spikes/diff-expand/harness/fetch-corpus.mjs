// Rebuilds everything the corpus needs outside the worktree (default /tmp/diffexpand-spike,
// override with SPIKE_WORK): shallow clones of the open-source repos, the three single
// files (large TypeScript, large Python, minified JS) and the two syntax-error files.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORK, repoDir } from "./materialize.mjs";
import { loadCases } from "./cases.mjs";

const REPOS = {
  flask: "pallets/flask", httpx: "encode/httpx", cobra: "spf13/cobra", gin: "gin-gonic/gin",
  ripgrep: "BurntSushi/ripgrep", axum: "tokio-rs/axum", gson: "google/gson",
  sinatra: "sinatra/sinatra", rack: "rack/rack", express: "expressjs/express",
};
const FILES = {
  "checker.ts": "https://raw.githubusercontent.com/microsoft/TypeScript/v5.6.3/src/compiler/checker.ts",
  "frame.py": "https://raw.githubusercontent.com/pandas-dev/pandas/v2.2.3/pandas/core/frame.py",
  "react.production.min.js": "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
};
const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 30 });

mkdirSync(join(WORK, "repos"), { recursive: true });
mkdirSync(join(WORK, "files"), { recursive: true });
const cases = loadCases();
for (const [name, slug] of Object.entries(REPOS)) {
  const dir = join(WORK, "repos", name);
  if (!existsSync(dir)) { mkdirSync(dir); git(["init", "-q"], dir); git(["remote", "add", "origin", `https://github.com/${slug}.git`], dir); }
  const shas = [...new Set(cases.filter((c) => c.repo === name).map((c) => c.sha))];
  for (const sha of shas) {
    try { git(["cat-file", "-e", `${sha}^{commit}`], dir); git(["cat-file", "-e", `${sha}^^{commit}`], dir); }
    catch { git(["fetch", "-q", "--depth", "2", "origin", sha], dir); }
  }
}
for (const [name, url] of Object.entries(FILES)) {
  const p = join(WORK, "files", name);
  if (!existsSync(p)) execFileSync("curl", ["-sfL", "-o", p, url]);
}
// Syntax-error files: a real file with one line damaged in an EARLIER function, so line
// numbers (and the expected units) stay the same as in the intact file.
const show = (repo, sha, path) => git(["show", `${sha}:${path}`], repoDir(repo));
{
  const lines = show("flask", "06ea505ce2", "src/flask/ctx.py").split("\n");
  const i = lines.findIndex((l) => l.includes("ctx._after_request_functions.append(f)"));
  lines[i] = lines[i].replace("append(f)", "append(f"); // unclosed parenthesis
  writeFileSync(join(WORK, "files", "broken_ctx.py"), lines.join("\n"));
}
{
  const lines = show("unvibe", "66c12e3f4e", "packages/service/src/agent/acp/runner.ts").split("\n");
  let i = 369;
  while (i > 0 && !/^    \}$/.test(lines[i])) i--;
  lines[i] = ""; // a closing brace of a block in an earlier method goes missing
  writeFileSync(join(WORK, "files", "broken_runner.ts"), lines.join("\n"));
  console.log(`broken_runner.ts: blanked line ${i + 1}`);
}
console.log("corpus ready in", WORK);
