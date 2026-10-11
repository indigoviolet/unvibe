/** Bundle the Excalidraw browser entry with esbuild; report sizes. */
import { createRequire } from "node:module";
import fs from "node:fs";
import zlib from "node:zlib";

const require = createRequire("/home/venky/dev/unvibe.worktrees/diagram-spike/package.json");
const esbuild = require("esbuild");

const out = "out/excalidraw-bundle.js";
fs.mkdirSync("out", { recursive: true });
const t0 = Date.now();
await esbuild.build({
  entryPoints: ["src/excalidraw-entry.mjs"],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  outfile: out,
  logLevel: "warning",
});
const raw = fs.readFileSync(out);
console.log(`esbuild ms=${Date.now() - t0}`);
console.log(`excalidraw bundle raw=${(raw.length / 1048576).toFixed(2)}MB gzip=${(zlib.gzipSync(raw).length / 1048576).toFixed(2)}MB`);
