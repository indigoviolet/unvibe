/*global console process */
// `mise run release`: assemble a self-contained release tree in `./release/`
// (built service bundle + bundled ACP adapter entries + web build +
// prompts/fixture/README/notices + a generated dependency-lean package.json),
// pack `unvibe-<version>.tgz` at the repo root, and point the local orphan
// release branch at exactly that tree (one commit, no history).
//
// The version comes from package.json, or from the tag when set
// (--version / UNVIBE_RELEASE_VERSION / GITHUB_REF_NAME like v0.0.1-rc.1),
// or from `scripts/preview-publish.mjs` for preview builds
// (`<base>-preview.<slug>.<shortsha>` with `--branch preview/<slug>`).
// The branch is --branch / UNVIBE_RELEASE_BRANCH, defaulting to release-rc
// for -rc versions and release for finals, so candidates never overwrite
// the `release` ref users install from.
//
// The generated package.json carries an `unvibe` field recording what the
// tree is (channel, source branch + commit, base branch + commit for merged
// previews, built tree commit, build time), so `unvibe update --list` (and
// later the in-app picker) can show it without a second mechanism.
//
// The release package needs no build step on the user's machine: no
// `prepare`, no devDependencies, no workspaces, and no lifecycle
// scripts at all (issue #42: a lifecycle script makes npm link a git
// install to its temporary preparation clone and then delete the
// clone, leaving a dangling bin). Setup runs from the CLI itself on
// first start instead. `npm install -g
// github:<org>/unvibe#release` installs it with no flags. Nothing is
// pushed (CI pushes on tag).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildUnvibeField } from "./preview-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = path.join(ROOT, "release");

/**
 * urllib3's licence as it actually is: MIT (upstream `LICENSE.txt`,
 * https://github.com/urllib3/urllib3/blob/main/LICENSE.txt — do not assume;
 * this text was read from that file and is quoted here verbatim).
 */
const URLLIB3_MIT = `MIT License

Copyright (c) 2008-2020 Andrey Petrov and contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const RUNTIME_DEPS = [
  "fastify",
  "@fastify/static",
  "@fastify/websocket",
  "@modelcontextprotocol/sdk",
  "immer",
  "ws",
];

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 300_000 });
  if (r.status !== 0) {
    console.error(`release: ${cmd} ${args.join(" ")} failed\n${r.stdout ?? ""}\n${r.stderr ?? ""}`);
    process.exit(r.status ?? 1);
  }
  return (r.stdout ?? "").trim();
}

const srcPkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

function flagValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : null;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`usage: node scripts/release.mjs [--version <semver>] [--branch <name>] [--source-branch <name>] [--print-notices]
  --version         override the release version (default: package.json; in CI, the tag via GITHUB_REF_NAME)
  --branch          local branch to point at the release tree (default: release-rc for -rc versions, else release)
  --source-branch   source branch the tree was built from (preview builds; recorded in package.json, null otherwise)
  --source-commit   source-branch commit the tree was built from (merged previews; null otherwise)
  --base-branch     base the source branch was merged onto, usually main (merged previews; null otherwise)
  --base-commit     base-side commit the tree was built from (merged previews; null otherwise)
  env: UNVIBE_RELEASE_VERSION, UNVIBE_RELEASE_BRANCH, UNVIBE_RELEASE_SOURCE_BRANCH, UNVIBE_RELEASE_SOURCE_COMMIT, UNVIBE_RELEASE_BASE_BRANCH, UNVIBE_RELEASE_BASE_COMMIT, GITHUB_REF_NAME (tag like v0.0.1-rc.1)`);
  process.exit(0);
}

function stripV(v) {
  return v.startsWith("v") ? v.slice(1) : v;
}

/**
 * Release version: explicit --version, else UNVIBE_RELEASE_VERSION, else the
 * tag name when running on a tag (GITHUB_REF_NAME=v0.0.1-rc.1 → 0.0.1-rc.1),
 * else package.json. The generated package.json version and the tarball name
 * both come from this, so the tag and the artifact always agree.
 */
function resolveVersion() {
  const explicit = flagValue("--version") ?? process.env.UNVIBE_RELEASE_VERSION ?? null;
  if (explicit) return stripV(explicit);
  const ref = process.env.GITHUB_REF_NAME ?? "";
  if (/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(ref)) return stripV(ref);
  return srcPkg.version;
}

/**
 * Release branch: explicit --branch, else UNVIBE_RELEASE_BRANCH, else
 * release-rc for -rc versions and release for finals. RC candidates must
 * never overwrite the `release` ref a user installs from.
 */
function resolveBranch(ver) {
  const explicit = flagValue("--branch") ?? process.env.UNVIBE_RELEASE_BRANCH ?? null;
  if (explicit) return explicit;
  return ver.includes("-rc.") ? "release-rc" : "release";
}

const version = resolveVersion();
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`release: bad version ${JSON.stringify(version)} — want X.Y.Z with optional -rc.N`);
  process.exit(1);
}
const releaseBranch = resolveBranch(version);
// Source branch for preview builds (recorded in the generated package.json;
// null for tag-built release/release-rc, which run detached).
const sourceBranch = flagValue("--source-branch") ?? process.env.UNVIBE_RELEASE_SOURCE_BRANCH ?? null;
// Dual-side provenance for previews built as base + branch (issue #41):
// the branch- and base-side commits. `commitFull` below is the built tree
// itself (the merge result). All null for releases and older previews.
const sourceCommit = flagValue("--source-commit") ?? process.env.UNVIBE_RELEASE_SOURCE_COMMIT ?? null;
const baseBranch = flagValue("--base-branch") ?? process.env.UNVIBE_RELEASE_BASE_BRANCH ?? null;
const baseCommit = flagValue("--base-commit") ?? process.env.UNVIBE_RELEASE_BASE_COMMIT ?? null;
const commitFull = sh("git", ["rev-parse", "HEAD"], ROOT);
const builtAt = new Date().toISOString();
console.log(`release: unvibe ${version} (source package.json ${srcPkg.version}, branch ${releaseBranch})`);

// 1. Required build output must exist (`mise run release` builds first).
const needed = [
  "packages/service/dist/index.js",
  "packages/service/dist/adapters/claude.js",
  "packages/service/dist/adapters/codex.js",
  "packages/web/dist/index.html",
  "packages/web/dist/web-meta.json",
];
for (const f of needed) {
  if (!existsSync(path.join(ROOT, f))) {
    console.error(`release: missing ${f} — run \`mise run build\` first`);
    process.exit(1);
  }
}
// Tree-sitter grammars (issue #133): plain `.wasm` files beside the
// service bundle. The outline parser refuses to run without them.
for (const g of [
  "web-tree-sitter.wasm",
  "tree-sitter-python.wasm",
  "tree-sitter-go.wasm",
  "tree-sitter-rust.wasm",
  "tree-sitter-java.wasm",
  "tree-sitter-ruby.wasm",
  "tree-sitter-javascript.wasm",
  "tree-sitter-typescript.wasm",
  "tree-sitter-tsx.wasm",
]) {
  if (!existsSync(path.join(ROOT, "packages/service/dist/grammars", g))) {
    console.error(`release: missing packages/service/dist/grammars/${g} — run \`mise run build\` first`);
    process.exit(1);
  }
}

// `--print-notices`: emit THIRD-PARTY-NOTICES.md to stdout without doing a
// release (used by the staleness test to verify coverage of the current
// build + fixture without packing a tarball or touching git).
if (process.argv.includes("--print-notices")) {
  console.log(buildNotices());
  process.exit(0);
}

// 2. Assemble the tree (same relative layout as the repo so the service's
// walk-up resolution for prompts/fixtures/web keeps working).
rmSync(RELEASE, { recursive: true, force: true });
mkdirSync(RELEASE, { recursive: true });
const copy = (from, to) => {
  mkdirSync(path.dirname(path.join(RELEASE, to)), { recursive: true });
  cpSync(path.join(ROOT, from), path.join(RELEASE, to), { recursive: true });
};
copy("packages/service/dist/index.js", "packages/service/dist/index.js");
if (existsSync(path.join(ROOT, "packages/service/dist/index.js.map"))) {
  copy("packages/service/dist/index.js.map", "packages/service/dist/index.js.map");
}
copy("packages/service/dist/adapters/claude.js", "packages/service/dist/adapters/claude.js");
copy("packages/service/dist/adapters/codex.js", "packages/service/dist/adapters/codex.js");
// Self-contained switch-helper bundle for the in-app version picker
// (issue #36): the service copies it to the data dir and spawns the copy,
// so the global npm swap cannot pull it out from under the helper.
copy("packages/service/dist/update-helper.js", "packages/service/dist/update-helper.js");
// Tree-sitter grammars (issue #133): plain `.wasm` files the service
// loads from beside its bundle — shipped verbatim, no install step.
copy("packages/service/dist/grammars", "packages/service/dist/grammars");
copy("packages/web/dist", "packages/web/dist");
copy("prompts", "prompts");
copy("fixtures/urllib3-5020", "fixtures/urllib3-5020");
copy("README.md", "README.md");
copy("LICENSE", "LICENSE");

// 3. Notices for everything bundled (service bundle + both adapter bundles).
const notices = buildNotices();
writeFileSync(path.join(RELEASE, "THIRD-PARTY-NOTICES.md"), notices);

// 4. Generated package.json: bin + pinned runtime deps only.
const deps = {};
for (const name of RUNTIME_DEPS) {
  deps[name] = runtimeVersion(name);
}
/**
 * Exact installed version of a runtime dep. Reads the top-level
 * `node_modules/<name>/package.json` directly: resolving `<name>/package.json`
 * through the loader can land on an exports-mapped stub without a version
 * (e.g. `@modelcontextprotocol/sdk` maps it to `dist/cjs/package.json`).
 */
function runtimeVersion(name) {
  const direct = path.join(ROOT, "node_modules", name, "package.json");
  if (existsSync(direct)) {
    const v = JSON.parse(readFileSync(direct, "utf8")).version;
    if (v) return v;
  }
  const req = createRequire(path.join(ROOT, "package.json"));
  let dir = path.dirname(req.resolve(name));
  for (let i = 0; i < 6; i++) {
    const pjPath = path.join(dir, "package.json");
    if (existsSync(pjPath)) {
      const pj = JSON.parse(readFileSync(pjPath, "utf8"));
      if (pj.name === name && pj.version) return pj.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  console.error(`release: cannot determine version of ${name}`);
  process.exit(1);
}
const releasePkg = {
  name: "unvibe",
  version,
  description: "Reader for code changes: localhost service + installable web app.",
  license: "MIT",
  type: "module",
  bin: { unvibe: "./packages/service/dist/index.js" },
  // No lifecycle scripts (issue #42): see the header. Setup (token,
  // unvibe:// handler, start-at-login unit) runs from the CLI on first
  // start / after an update instead — `src/cli/setup/ensure.ts`.
  dependencies: deps,
  engines: { node: ">=24" },
  // Provenance for `unvibe update --list` (and the later in-app picker):
  // which channel this tree is, what commit built it, and when. Additive
  // metadata only — install behaviour is unchanged.
  unvibe: buildUnvibeField({
    channel: releaseBranch,
    commit: commitFull,
    builtAt,
    sourceBranch,
    sourceVersion: srcPkg.version,
    sourceCommit,
    baseBranch,
    baseCommit,
  }),
};
writeFileSync(path.join(RELEASE, "package.json"), JSON.stringify(releasePkg, null, 2) + "\n");
console.log(`release: dependencies: ${Object.entries(deps).map(([k, v]) => `${k}@${v}`).join(", ")}`);

// 4b. When the release version differs from the source (RC candidates like
// 0.0.1-rc.1 built from a 0.0.1 tree), patch the release tree's service
// bundle so `unvibe --version` and /api/health report the tag version.
// Final releases match by construction (release:tag bumps the source first).
if (version !== srcPkg.version) {
  const distIndex = path.join(RELEASE, "packages/service/dist/index.js");
  let dist = readFileSync(distIndex, "utf8");
  const svcFrom = `SERVICE_VERSION = "${srcPkg.version}"`;
  const mcpFrom = `MCP_SERVICE_VERSION = "${srcPkg.version}"`;
  if (!dist.includes(svcFrom) || !dist.includes(mcpFrom)) {
    console.error(`release: cannot patch versions in the bundle (want ${svcFrom} and ${mcpFrom})`);
    process.exit(1);
  }
  dist = dist.split(svcFrom).join(`SERVICE_VERSION = "${version}"`).split(mcpFrom).join(`MCP_SERVICE_VERSION = "${version}"`);
  writeFileSync(distIndex, dist);
  console.log(`release: patched bundle versions ${srcPkg.version} -> ${version}`);
}

// 5. Tarball at the repo root (remove stale ones first so unvibe-*.tgz
// globs in CI attach exactly one file).
for (const e of readdirSync(ROOT)) {
  if (e.startsWith("unvibe-") && e.endsWith(".tgz")) rmSync(path.join(ROOT, e), { force: true });
}
const tarball = sh("npm", ["pack", "--pack-destination", ROOT], RELEASE);
console.log(`release: tarball ${tarball}`);
if (tarball !== `unvibe-${version}.tgz`) {
  console.error(`release: tarball name ${tarball} does not match version ${version}`);
  process.exit(1);
}

// 6. Point the local orphan release branch at exactly this tree.
sh("git", ["update-ref", `refs/heads/${releaseBranch}`, commitTree()], ROOT);
console.log(`release: branch ${releaseBranch} -> ${sh("git", ["rev-parse", "--short", releaseBranch], ROOT)}`);
console.log(`release: tree ${RELEASE} (no push performed)`);

/**
 * Identity for the machine-made release commit: the user's own git identity
 * when configured, else a fixed fallback. `git commit-tree` fails without
 * an author/committer, and CI runners (and fresh machines) have no git
 * identity configured — without this, `mise run release` fails there.
 */
function releaseIdentityArgs() {
  const configured = (key, envKey) => {
    if (process.env[envKey]) return true;
    const r = spawnSync("git", ["config", key], { cwd: ROOT, encoding: "utf8" });
    return r.status === 0 && Boolean((r.stdout ?? "").trim());
  };
  const args = [];
  if (!configured("user.name", "GIT_AUTHOR_NAME")) args.push("-c", "user.name=unvibe");
  if (!configured("user.email", "GIT_AUTHOR_EMAIL")) args.push("-c", "user.email=unvibe@localhost");
  return args;
}

function commitTree() {
  const { tmpdir } = process.getBuiltinModule("node:os");
  const tmpIndex = path.join(tmpdir(), `unvibe-release-index-${process.pid}`);
  rmSync(tmpIndex, { force: true });
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  // Explicit --work-tree makes the staged paths relative to RELEASE (no
  // `release/` prefix); GIT_INDEX_FILE keeps the real index untouched.
  const gitDir = path.join(ROOT, ".git");
  const add = spawnSync("git", ["--git-dir", gitDir, "--work-tree", RELEASE, "add", "-A", "."], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });
  if (add.status !== 0) {
    console.error(`release: git add failed\n${add.stderr ?? ""}`);
    process.exit(add.status ?? 1);
  }
  const tree = spawnSync("git", ["write-tree"], { cwd: ROOT, env, encoding: "utf8" });
  if (tree.status !== 0) {
    console.error(`release: git write-tree failed\n${tree.stderr ?? ""}`);
    process.exit(tree.status ?? 1);
  }
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  const short = (head.stdout ?? "").trim().slice(0, 12);
  const day = new Date().toISOString().slice(0, 10);
  const msg =
    (sourceBranch
      ? `unvibe preview ${version} from ${sourceBranch} (source ${short} ${day})\n`
      : `unvibe release ${version} (source ${short} ${day})\n`) +
    `\nSelf-contained install tree: no lifecycle scripts (issue #42; setup runs on first start), no prepare, no devDependencies. ` +
    `Install with \`npm install -g github:<org>/unvibe#${releaseBranch}\`.`;
  const commit = spawnSync("git", [...releaseIdentityArgs(), "commit-tree", (tree.stdout ?? "").trim(), "-m", msg], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });
  if (commit.status !== 0) {
    console.error(`release: git commit-tree failed\n${commit.stderr ?? ""}`);
    process.exit(commit.status ?? 1);
  }
  rmSync(tmpIndex, { force: true });
  return (commit.stdout ?? "").trim();
}

/**
 * THIRD-PARTY-NOTICES.md from the esbuild metafiles of the three service
 * bundles plus the web build's module list (`web-meta.json`, written by the
 * `unvibe-web-meta` Vite plugin — no hand-kept list):
 * - every npm package contributing bundled code, with version + license;
 * - the full Apache-2.0 text (covers all Apache-licensed bundled code) and
 *   the Anthropic SDK license note (as before);
 * - the full MIT texts for MIT-licensed web packages (issue #14);
 * - the bundled web fonts: `@fontsource/*` copyrights, the SIL Open Font
 *   License 1.1 text, and the shipped font asset files;
 * - the demo fixture (urllib3/urllib3#5020 diff + PR description) with
 *   attribution and urllib3's licence;
 * - the pre-rendered D2 demo diagrams, which embed Source Sans Pro font
 *   subsets written by `d2` 0.9.0;
 * - a pointer to Unvibe's own MIT LICENSE (shipped separately).
 *
 * Do not change which things are bundled: this only describes them.
 */
function buildNotices() {
  const bundles = [
    ["service dist/index.js", "packages/service/dist/meta.json"],
    ["adapter dist/adapters/claude.js", "packages/service/dist/adapters/claude-meta.json"],
    ["adapter dist/adapters/codex.js", "packages/service/dist/adapters/codex-meta.json"],
    ["web dist/assets", "packages/web/dist/web-meta.json"],
  ];
  /** key `${name}@${version}` -> { name, version, license, in: Set } */
  const found = new Map();
  const pkgOf = (file) => {
    const parts = file.split("node_modules/");
    const last = parts[parts.length - 1];
    const segs = last.split("/");
    const name = last.startsWith("@") ? `${segs[0]}/${segs[1]}` : segs[0];
    const dir = path.join(ROOT, "node_modules", name);
    return { name, dir };
  };
  for (const [label, metaRel] of bundles) {
    const metaPath = path.join(ROOT, metaRel);
    if (!existsSync(metaPath)) {
      console.error(`release: missing metafile ${metaRel} — rebuild with \`mise run build\``);
      process.exit(1);
    }
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    for (const input of Object.keys(meta.inputs ?? {})) {
      if (!input.includes("node_modules/")) continue;
      const { name, dir } = pkgOf(input);
      const pjPath = path.join(dir, "package.json");
      if (!existsSync(pjPath)) continue;
      const pj = JSON.parse(readFileSync(pjPath, "utf8"));
      const key = `${pj.name ?? name}@${pj.version ?? "?"}`;
      if (!found.has(key)) {
        found.set(key, { name: pj.name ?? name, version: pj.version ?? "?", license: pj.license ?? "?", in: new Set() });
      }
      found.get(key).in.add(label);
    }
  }
  const rows = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  const webRows = rows.filter((r) => r.in.has("web dist/assets"));
  const lines = [
    "# Third-party notices (bundled code)",
    "",
    "The release tree ships bundles that include code from these npm",
    "packages (the release `dependencies` are only the small runtime set the",
    "service bundle loads externally; everything below is inlined). The",
    "service and adapter rows come from the esbuild metafiles; the web rows",
    "come from the Vite/Rollup build's module list",
    "(`packages/web/dist/web-meta.json`, written by the `unvibe-web-meta`",
    "plugin — not a hand-kept list). Legal comments from the original",
    "sources are also preserved in the bundles.",
    "",
    "| Package | Version | License | Bundled in |",
    "|---|---|---|---|",
  ];
  for (const r of rows) {
    lines.push(`| ${r.name} | ${r.version} | ${r.license} | ${[...r.in].sort().join(", ")} |`);
  }
  // Full Apache-2.0 text (covers all Apache-licensed rows above).
  const apacheSrc = path.join(ROOT, "node_modules", "@agentclientprotocol", "codex-acp", "LICENSE");
  if (existsSync(apacheSrc)) {
    lines.push("", "## Apache License 2.0", "", readFileSync(apacheSrc, "utf8").trim());
  }
  // Anthropic SDK terms (proprietary notice; the SDK README documents
  // bundling via its `/core` entry and compiled-binary embedding).
  const anthropicLicense = path.join(ROOT, "node_modules", "@anthropic-ai", "claude-agent-sdk", "LICENSE.md");
  if (existsSync(anthropicLicense)) {
    lines.push("", "## Claude Agent SDK terms", "", readFileSync(anthropicLicense, "utf8").trim());
  }
  lines.push(
    "",
    "Claude Agent SDK use is additionally subject to the Legal Agreements at",
    "https://code.claude.com/docs/en/legal-and-compliance.",
    "",
  );
  lines.push(...webMitTexts(webRows));
  lines.push(...webFontNotices(webRows));
  lines.push(...fixtureNotices());
  lines.push(...d2DiagramNotices());
  lines.push(...grammarNotices());
  lines.push(
    "## Unvibe's own licence",
    "",
    "Unvibe itself is MIT-licensed. Its licence ships separately as `LICENSE`",
    "at the root of this release tree and is not repeated here.",
    "",
  );
  console.log(`release: notices for ${rows.length} bundled packages`);
  return lines.join("\n");
}

/**
 * Full MIT licence texts for the MIT-licensed web rows (deduped by text;
 * each lists the packages it applies to). The web bundle is minified, so
 * the table row alone does not carry the copyright + permission notice MIT
 * requires in redistributions.
 */
function webMitTexts(webRows) {
  /** text -> { text, packages: string[] } */
  const byText = new Map();
  for (const r of webRows) {
    if (r.license !== "MIT") continue;
    const text = readWebLicenseText(r.name);
    if (!text) continue;
    if (!byText.has(text)) byText.set(text, { text, packages: [] });
    byText.get(text).packages.push(`${r.name}@${r.version}`);
  }
  if (byText.size === 0) return [];
  const lines = ["## Web bundle MIT licences", ""];
  for (const { text, packages } of [...byText.values()].sort((a, b) => a.packages[0].localeCompare(b.packages[0]))) {
    lines.push(`The following MIT text applies to: ${packages.sort().join(", ")}.`, "", text.trim(), "");
  }
  return lines;
}

/** Full text of `node_modules/<name>/LICENSE*` (first match wins). */
function readWebLicenseText(name) {
  const dir = path.join(ROOT, "node_modules", name);
  // Lowercase `license` included: several Shiki-transitive packages
  // (hast-util-*, mdast-util-*) ship only that name (issue #23).
  const candidates = [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENSE-MIT.txt",
    "LICENCE",
    "LICENCE.md",
    "license",
    "license.md",
    "license.txt",
  ];
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return null;
}

/**
 * Bundled web fonts (issue #14): every `@fontsource/*` package in the web
 * build, with version, the copyright/reserved-name notice as the package
 * states it, the shipped font asset files, and the SIL Open Font License
 * 1.1 text the packages license under (confirmed in each package's
 * `LICENSE` + `package.json` `"license": "OFL-1.1"`).
 */
function webFontNotices(webRows) {
  const fonts = webRows.filter((r) => r.name.startsWith("@fontsource/"));
  if (fonts.length === 0) return [];
  const lines = ["## Web fonts (SIL Open Font License 1.1)", ""];
  const oflBodies = new Map();
  for (const f of fonts.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = readWebLicenseText(f.name) ?? "";
    const { head, body } = splitFontLicense(full);
    lines.push(`- ${f.name}@${f.version}: ${head.replace(/\s+/g, " ").trim()}`);
    if (body && !oflBodies.has(body)) oflBodies.set(body, f.name);
  }
  lines.push(
    "",
    "The fonts are compiled into the web build as",
    "`packages/web/dist/assets/*.woff` / `*.woff2` (from the `@fontsource/*`",
    "`files/` directories). This release ships these font files:",
    "",
  );
  for (const f of listDistFiles("packages/web/dist/assets", [".woff", ".woff2"])) {
    lines.push(`- packages/web/dist/assets/${f}`);
  }
  lines.push("");
  if (oflBodies.size === 1) {
    lines.push("All of the above fonts use the same licence text (SIL Open Font License 1.1):", "");
    lines.push(`(as stated in ${[...oflBodies.values()][0]}/LICENSE)`, "", [...oflBodies.keys()][0].trim(), "");
  } else {
    for (const [body, owner] of oflBodies) {
      lines.push(`Licence text (as stated in ${owner}/LICENSE):`, "", body.trim(), "");
    }
  }
  return lines;
}

/** Split a `@fontsource` LICENSE into copyright head + OFL body. */
function splitFontLicense(full) {
  const marker = full.indexOf("SIL OPEN FONT LICENSE");
  if (marker < 0) return { head: full.trim(), body: "" };
  // The head is the copyright/reserved-name notice; the body starts at the
  // dash rule above the OFL title when present.
  const rule = full.lastIndexOf("---", marker);
  const bodyStart = rule >= 0 ? rule : marker;
  const head = full.slice(0, bodyStart).replace(/-+\s*$/, "").trim();
  return { head, body: full.slice(bodyStart).trim() };
}

function listDistFiles(relDir, exts) {
  const dir = path.join(ROOT, relDir);
  try {
    return readdirSync(dir).filter((e) => exts.some((x) => e.endsWith(x))).sort();
  } catch {
    return [];
  }
}

/**
 * Demo fixture (issue #14): `fixtures/urllib3-5020/` carries the diff and
 * PR description from urllib3/urllib3#5020, shipped in the release tree so
 * the demo works offline.
 */
function fixtureNotices() {
  const files = listDistFiles("fixtures/urllib3-5020", [".md", ".json"]);
  const recordings = listDistFiles("fixtures/urllib3-5020/recordings", [".md"]);
  const diagrams = listDistFiles("fixtures/urllib3-5020/diagrams", [".svg"]);
  const lines = [
    "## Demo fixture (urllib3/urllib3#5020)",
    "",
    "The `fixtures/urllib3-5020/` directory in this release (demo diff, PR",
    "description, recordings, snapshot and pre-rendered diagrams) derives",
    "from urllib3/urllib3 pull request #5020:",
    "",
    "- upstream repository: https://github.com/urllib3/urllib3",
    "- pull request: https://github.com/urllib3/urllib3/pull/5020",
    "  (\"Unfold obsolete folded response headers\")",
    "",
    "Fixture files shipped:",
    "",
  ];
  for (const f of files) lines.push(`- fixtures/urllib3-5020/${f}`);
  for (const r of recordings) lines.push(`- fixtures/urllib3-5020/recordings/${r}`);
  for (const d of diagrams) lines.push(`- fixtures/urllib3-5020/diagrams/${d}`);
  lines.push(
    "",
    "urllib3 is MIT-licensed. Its licence file (upstream",
    "`LICENSE.txt`, verified October 2026) reads:",
    "",
    URLLIB3_MIT.trim(),
    "",
  );
  return lines;
}

/**
 * Tree-sitter grammars (issue #133): the `.wasm` files in
 * `packages/service/dist/grammars/` are build-time copies of the
 * devDependency sources (no install step, no native code). The runtime
 * (`web-tree-sitter`, MIT © 2018 Max Brunsfeld) and the eight grammar
 * files (`@vscode/tree-sitter-wasm`, MIT © Microsoft Corporation) each
 * ship their licence below as distributed in `node_modules`.
 */
function grammarNotices() {
  const readLicense = (dir) => {
    try {
      return readFileSync(path.join(ROOT, "node_modules", dir, "LICENSE"), "utf8").trim();
    } catch {
      return null;
    }
  };
  const readVersion = (dir) => {
    try {
      return JSON.parse(readFileSync(path.join(ROOT, "node_modules", dir, "package.json"), "utf8")).version ?? "?";
    } catch {
      return "?";
    }
  };
  const runtimeLicense = readLicense("web-tree-sitter");
  const grammarLicense = readLicense("@vscode/tree-sitter-wasm");
  if (!runtimeLicense || !grammarLicense) return [];
  const files = listDistFiles("packages/service/dist/grammars", [".wasm"]);
  return [
    "## Tree-sitter grammars (enclosing-unit expansion)",
    "",
    "The `packages/service/dist/grammars/` directory in this release holds",
    "plain `.wasm` files copied at build time from two MIT-licensed npm",
    "packages (dev-only sources; the release has no new dependency):",
    "",
    `- web-tree-sitter@${readVersion("web-tree-sitter")}: the WebAssembly`,
    "  runtime (`web-tree-sitter.wasm`), loaded by the service to find the",
    "  enclosing function or class of a hunk:",
    "",
    runtimeLicense,
    "",
    `- @vscode/tree-sitter-wasm@${readVersion("@vscode/tree-sitter-wasm")}:`,
    "  the prebuilt grammar files:",
    "",
    ...files.map((f) => `- packages/service/dist/grammars/${f}`),
    "",
    grammarLicense,
    "",
  ];
}

/**
 * Pre-rendered D2 demo diagrams (issue #14): the SVGs in
 * `fixtures/urllib3-5020/diagrams/` embed WOFF font subsets written by
 * `d2` 0.9.0 (the pinned diagram renderer). The embedded subsets are
 * Source Sans Pro Bold and Italic (decoded from the SVGs' own font name
 * tables): © 2010–2018 Adobe Systems Incorporated, Reserved Font Name
 * 'Source', licensed under the SIL Open Font License 1.1 — the same
 * licence text reproduced in the Web fonts section above, which covers
 * these subsets too.
 */
function d2DiagramNotices() {
  const diagrams = listDistFiles("fixtures/urllib3-5020/diagrams", [".svg"]);
  if (diagrams.length === 0) return [];
  return [
    "## Demo diagrams (D2-embedded Source Sans Pro subsets)",
    "",
    "The pre-rendered demo SVGs embed WOFF font subsets produced by `d2`",
    "(pinned version 0.9.0 in `mise.toml`; rendered with `--bundle=false`,",
    "so the subsets travel inside the SVG files themselves):",
    "",
    ...diagrams.map((d) => `- fixtures/urllib3-5020/diagrams/${d}`),
    "",
    "Each SVG's embedded font name table identifies the source font as",
    "Source Sans Pro (Bold and/or Italic subsets):",
    "",
    "- Copyright © 2010-2018 Adobe Systems Incorporated",
    "  (http://www.adobe.com/), with Reserved Font Name 'Source'.",
    "- Licence: SIL Open Font License, Version 1.1 — see the full text in",
    "  the Web fonts section above (same licence, same obligations:",
    "  keep this copyright notice with the licence text).",
    "",
    "`d2` itself is not shipped in this release (it runs on the",
    "developer's machine to re-render diagrams); only these SVG outputs",
    "and their embedded subsets ship here.",
    "",
  ];
}
