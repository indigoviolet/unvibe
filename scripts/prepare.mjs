/*global console process URL */
 // `prepare` (runs on `npm install -g github:<org>/unvibe` and before
// `npm pack`): build service + web dist from a git install, where
// workspaces + devDependencies are present. Skips when dist is already
// built so plain `npm install` in a checkout stays fast.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const NEEDED = [
  "packages/shared/dist/index.js",
  "packages/service/dist/index.js",
  "packages/web/dist/index.html",
];

if (NEEDED.every((f) => existsSync(new URL(`../${f}`, import.meta.url)))) {
  console.log("prepare: dist present, skipping build");
} else {
  console.log("prepare: building workspaces…");
  const r = spawnSync("npm", ["run", "build", "--workspaces", "--if-present"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    console.error("prepare: build failed");
    process.exit(r.status ?? 1);
  }
}
