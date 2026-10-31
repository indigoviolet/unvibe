/*global console process */
// `node scripts/generate-release-notes.mjs --channel <ref> --version <v>
//   [--output <file>] [--notes-file <file>] [--head <ref>] [--repo <slug>]`
// Generate `release-notes.json` for a build (#330). All git/gh calls go
// through one runner seam so tests stub them; `gh` runs with
// GITHUB_TOKEN unset (PRD §15).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateReleaseNotes, parseHumanNotes } from "./release-notes-gen-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : null;
};
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "usage: node scripts/generate-release-notes.mjs --channel <ref> --version <v> [--output <file>] [--notes-file <file>] [--head <ref>]",
  );
  process.exit(0);
}
const channel = flag("--channel");
const version = flag("--version");
if (!channel || !version) {
  console.error("generate-release-notes: --channel and --version are required");
  process.exit(2);
}
const out = flag("--output");
const notesFile = flag("--notes-file");
const head = flag("--head") ?? "HEAD";
const repo = flag("--repo") ?? "indigoviolet/unvibe";

function runner(cmd, argv) {
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: "utf8", timeout: 120_000, env });
  return Promise.resolve({
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    code: r.status ?? 1,
  });
}

let humanNotes = {};
if (notesFile) {
  humanNotes = parseHumanNotes(readFileSync(path.resolve(notesFile), "utf8"));
}

const notes = await generateReleaseNotes({ runner, channel, version, head, repo, humanNotes });
const text = JSON.stringify(notes, null, 2) + "\n";
if (out) {
  writeFileSync(path.resolve(out), text);
  console.log(
    `generate-release-notes: wrote ${out} (${channel} ${version}, ${notes.items.length} item(s), previous ${notes.previousVersion ?? "none"})`,
  );
} else {
  console.log(text);
}
