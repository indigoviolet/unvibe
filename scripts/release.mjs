/*global console process */
// `mise run release`: assemble a self-contained release tree in `./release/`
// (built service bundle + bundled ACP adapter entries + web build +
// prompts/fixture/README/notices + a generated dependency-lean package.json),
// pack `unvibe-<version>.tgz` at the repo root, and point the local orphan
// `release` branch at exactly that tree (one commit, no history).
//
// The release package needs no build step and no lifecycle scripts on the
// user's machine: no `prepare`, no `postinstall`, no devDependencies, no
// workspaces. `npm install -g github:<org>/unvibe#release` installs it with
// no flags. Nothing is pushed (CI pushes on tag).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = path.join(ROOT, "release");

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
const version = srcPkg.version;
console.log(`release: unvibe ${version}`);

// 1. Required build output must exist (`mise run release` builds first).
const needed = [
  "packages/service/dist/index.js",
  "packages/service/dist/adapters/claude.js",
  "packages/service/dist/adapters/codex.js",
  "packages/web/dist/index.html",
];
for (const f of needed) {
  if (!existsSync(path.join(ROOT, f))) {
    console.error(`release: missing ${f} — run \`mise run build\` first`);
    process.exit(1);
  }
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
  dependencies: deps,
  engines: { node: ">=24" },
};
writeFileSync(path.join(RELEASE, "package.json"), JSON.stringify(releasePkg, null, 2) + "\n");
console.log(`release: dependencies: ${Object.entries(deps).map(([k, v]) => `${k}@${v}`).join(", ")}`);

// 5. Tarball at the repo root.
const tarball = sh("npm", ["pack", "--pack-destination", ROOT], RELEASE);
console.log(`release: tarball ${tarball}`);

// 6. Point the local orphan `release` branch at exactly this tree.
sh("git", ["update-ref", "refs/heads/release", commitTree()], ROOT);
console.log(`release: branch release -> ${sh("git", ["rev-parse", "--short", "release"], ROOT)}`);
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
  const msg =
    `unvibe release ${version} (source ${(head.stdout ?? "").trim().slice(0, 12)} ${new Date().toISOString().slice(0, 10)})\n` +
    `\nSelf-contained install tree: no prepare/postinstall, no devDependencies. ` +
    `Install with \`npm install -g github:<org>/unvibe#release\`.`;
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
 * THIRD-PARTY-NOTICES.md from the esbuild metafiles of the three bundles:
 * every npm package contributing bundled code, with version + license, the
 * full Apache-2.0 text (covers all Apache-licensed bundled code), and the
 * Anthropic SDK license note.
 */
function buildNotices() {
  const bundles = [
    ["service dist/index.js", "packages/service/dist/meta.json"],
    ["adapter dist/adapters/claude.js", "packages/service/dist/adapters/claude-meta.json"],
    ["adapter dist/adapters/codex.js", "packages/service/dist/adapters/codex-meta.json"],
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
  const lines = [
    "# Third-party notices (bundled code)",
    "",
    "The release tree ships esbuild bundles that include code from these npm",
    "packages (the release `dependencies` are only the small runtime set the",
    "service bundle loads externally; everything below is inlined). Legal",
    "comments from the original sources are also preserved in the bundles.",
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
  console.log(`release: notices for ${rows.length} bundled packages`);
  return lines.join("\n");
}
