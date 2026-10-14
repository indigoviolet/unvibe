/*global console process */
// `node scripts/release-notes.mjs <version> [--tag <tag>] [--output <file>]`:
// write the GitHub release body for an Unvibe tag.
//
// - First release (no previous v* tag): a short fixed text.
// - Later releases: merged commits since the previous tag
//   (`git log <prev>..<tag> --oneline`), plus the install commands.
//
// The install story assumes a public repository: the git ref installs
// with no credentials, and the attached tarball downloads from its plain
// releases/download URL with no login.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : null;
};

const rawVersion = args.find((a) => !a.startsWith("-")) ?? process.env.UNVIBE_RELEASE_VERSION ?? process.env.GITHUB_REF_NAME ?? "";
const version = rawVersion.startsWith("v") ? rawVersion.slice(1) : rawVersion;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`release-notes: bad version ${JSON.stringify(rawVersion)} — want X.Y.Z[-rc.N]`);
  process.exit(1);
}
const tag = flag("--tag") ?? (rawVersion.startsWith("v") ? rawVersion : `v${version}`);
const out = flag("--output") ?? flag("-o") ?? null;
const branch = version.includes("-rc.") ? "release-rc" : "release";

function sh(cmd, argv) {
  const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) {
    console.error(`release-notes: ${cmd} ${argv.join(" ")} failed\n${r.stderr ?? ""}`);
    process.exit(r.status ?? 1);
  }
  return (r.stdout ?? "").trim();
}

function listTags() {
  const out = sh("git", ["tag", "--list", "v*", "--sort=-v:refname"]);
  return out ? out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
}

const tags = listTags();
const idx = tags.indexOf(tag);
const prev = idx >= 0 ? (tags[idx + 1] ?? null) : (tags[0] ?? null);

let changes;
if (!prev) {
  changes = `First release. Self-contained install tree: built service bundle
(\`packages/service/dist/index.js\` plus bundled adapter entries
\`dist/adapters/\`), the web build, \`prompts/\`, the demo fixture,
\`README.md\`, \`LICENSE\` and \`THIRD-PARTY-NOTICES.md\`, with a generated
dependency-lean \`package.json\` (runtime deps only, no workspaces, no
lifecycle scripts).`;
} else {
  const log = sh("git", ["log", `${prev}..${tag}`, "--pretty=format:- %s (%h)", "--no-merges"]);
  const merges = sh("git", ["log", `${prev}..${tag}`, "--merges", "--pretty=format:- %s (%h)"]);
  const lines = [log, merges].map((s) => s.trim()).filter(Boolean).join("\n");
  changes = `Changes since ${prev}:\n\n${lines || "- (no changes listed)"}`;
}

const body = `# Unvibe ${version}

Install with no flags (Node 24 or newer):

\`\`\`sh
npm install -g github:indigoviolet/unvibe#${branch}
\`\`\`

No login needed: the repository is public. The attached tarball below
installs the same way — download it from its plain releases/download URL
and install the file:

\`\`\`sh
npm install -g ./unvibe-${version}.tgz
\`\`\`

## What is in this release

${changes}
`;

if (out) {
  writeFileSync(path.resolve(ROOT, out), body);
  console.log(`release-notes: wrote ${out} (${prev ? `since ${prev}` : "first release"})`);
} else {
  console.log(body);
}
