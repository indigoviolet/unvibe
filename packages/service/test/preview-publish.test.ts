/**
 * Preview publish helpers (issue #36): slug + version derivation, the
 * preview-only push guard, worktree resolution. Pure
 * `scripts/preview-lib.mjs` units — no network, no git runs.
 * The last describe runs a real dry-run publish (#330) in a temp repo
 * with stub `npm`/`gh`/`mise` on PATH (local git only, no network).
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertPreviewDeleteRef,
  assertPreviewPushRefspec,
  branchSlug,
  buildUnvibeField,
  isPreviewRef,
  isPrereleaseIdentifier,
  isValidPreviewVersion,
  parseWorktreeList,
  previewPushRefspec,
  previewRef,
  previewVersion,
  resolveWorktree,
  selectAllBranches,
  selectPruneRefs,
} from "../../../scripts/preview-lib.mjs";

describe("branchSlug", () => {
  it("makes branch names safe for semver + ref segments", () => {
    expect(branchSlug("feat/repo-add-by-url")).toBe("feat-repo-add-by-url");
    expect(branchSlug("feat/preview-builds")).toBe("feat-preview-builds");
    expect(branchSlug("ui/start-page-repo-scope")).toBe("ui-start-page-repo-scope");
    expect(branchSlug("main")).toBe("main");
    expect(branchSlug("release")).toBe("release");
  });

  it("collapses runs, trims dashes, drops empties", () => {
    expect(branchSlug("a//b__c..d")).toBe("a-b-c-d");
    expect(branchSlug("/leading/trailing/")).toBe("leading-trailing");
    expect(branchSlug("has space and\ttab")).toBe("has-space-and-tab");
    expect(branchSlug("///")).toBe("");
    expect(branchSlug("")).toBe("");
  });

  it("prefixes purely numeric slugs (semver forbids leading-zero numerics)", () => {
    expect(branchSlug("123")).toBe("b123");
    expect(branchSlug("007")).toBe("b007");
    // Alphanumeric identifiers may start with digits — left alone.
    expect(branchSlug("2fa-fix")).toBe("2fa-fix");
  });
});

describe("preview version", () => {
  it("assembles <base>-preview.<slug>.<sha>", () => {
    expect(previewVersion("0.0.1", "feat-preview-builds", "4d31b17")).toBe(
      "0.0.1-preview.feat-preview-builds.4d31b17",
    );
  });

  it("accepts the brief's shape as strict semver", () => {
    expect(isValidPreviewVersion("0.0.1-preview.feat-preview-builds.4d31b17")).toBe(true);
    expect(isValidPreviewVersion("0.0.1-preview.main.abcdef0")).toBe(true);
  });

  it("rejects non-preview and malformed versions", () => {
    expect(isValidPreviewVersion("0.0.1")).toBe(false);
    expect(isValidPreviewVersion("0.0.1-rc.1")).toBe(false);
    expect(isValidPreviewVersion("0.0.1-preview.feat_x.abc")).toBe(false); // _ not allowed
    expect(isValidPreviewVersion("0.0.1-preview..abc")).toBe(false);
    expect(isValidPreviewVersion("0.0.1-preview.007.abc")).toBe(false); // leading-zero numeric
    expect(isValidPreviewVersion("not-a-version")).toBe(false);
  });

  it("checks prerelease identifiers per semver §9", () => {
    expect(isPrereleaseIdentifier("feat-x")).toBe(true);
    expect(isPrereleaseIdentifier("0")).toBe(true);
    expect(isPrereleaseIdentifier("007")).toBe(false);
    expect(isPrereleaseIdentifier("")).toBe(false);
    expect(isPrereleaseIdentifier("a_b")).toBe(false);
  });
});

describe("preview push guard", () => {
  it("builds the only pushable refspec", () => {
    expect(previewRef("feat-x")).toBe("preview/feat-x");
    expect(previewPushRefspec("feat-x")).toBe(
      "refs/heads/preview/feat-x:refs/heads/preview/feat-x",
    );
    expect(() => previewPushRefspec("../release")).toThrow();
  });

  it("accepts only preview/*-onto-itself refspecs", () => {
    expect(assertPreviewPushRefspec("refs/heads/preview/feat-x:refs/heads/preview/feat-x")).toBe(
      "refs/heads/preview/feat-x:refs/heads/preview/feat-x",
    );
    for (const bad of [
      "refs/heads/release:refs/heads/release",
      "refs/heads/main:refs/heads/main",
      "refs/heads/preview/feat-x:refs/heads/preview/other",
      "refs/heads/preview/feat-x:refs/heads/release",
      "preview/feat-x",
      "",
    ]) {
      expect(() => assertPreviewPushRefspec(bad), bad).toThrow();
    }
  });

  it("recognises preview refs", () => {
    expect(isPreviewRef("preview/feat-x")).toBe(true);
    expect(isPreviewRef("release")).toBe(false);
    expect(isPreviewRef("preview/")).toBe(false);
    expect(isPreviewRef("preview/a/b")).toBe(false);
  });
});

const PORCELAIN = [
  "worktree /home/u/dev/unvibe",
  "HEAD 973dc34f04e30dda9205f743423f64a382ab4de5",
  "branch refs/heads/main",
  "",
  "worktree /home/u/.paseo/wt/preview-builds",
  "HEAD 4d31b171ff29a5d2035238ba3209ed4f8623ff1b",
  "branch refs/heads/feat/preview-builds",
  "",
  "worktree /home/u/.paseo/wt/detached",
  "HEAD 5de6af901b110c6508b25e65288469b391082edf",
  "detached",
  "",
].join("\n");

describe("worktree resolution", () => {
  it("parses porcelain entries incl. detached", () => {
    const entries = parseWorktreeList(PORCELAIN);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ path: "/home/u/dev/unvibe", branch: "main", detached: false });
    expect(entries[2]).toEqual({
      path: "/home/u/.paseo/wt/detached",
      branch: null,
      detached: true,
    });
  });

  it("resolves a branch to its worktree path, null when absent", () => {
    expect(resolveWorktree(PORCELAIN, "feat/preview-builds")).toBe(
      "/home/u/.paseo/wt/preview-builds",
    );
    expect(resolveWorktree(PORCELAIN, "main")).toBe("/home/u/dev/unvibe");
    expect(resolveWorktree(PORCELAIN, "no/such-branch")).toBeNull();
  });
});

describe("selectAllBranches (--all)", () => {
  it("publishes unmerged branches plus main itself, main first", () => {
    expect(selectAllBranches(["main", "feat/a", "fix/b"], ["feat/a", "fix/b"])).toEqual([
      "main",
      "feat/a",
      "fix/b",
    ]);
  });

  it("drops branches fully on main and publish artifacts", () => {
    expect(
      selectAllBranches(
        ["main", "feat/a", "merged-c", "preview/feat-a", "release"],
        ["feat/a"],
      ),
    ).toEqual(["main", "feat/a"]);
  });

  it("dedupes and omits main when it has no local branch", () => {
    expect(selectAllBranches(["feat/a", "feat/a"], ["feat/a"], "main")).toEqual(["feat/a"]);
  });
});

describe("buildUnvibeField (dual-side metadata)", () => {
  it("records both sides of a merged preview", () => {
    expect(
      buildUnvibeField({
        channel: "preview/feat-x",
        commit: "merge123",
        builtAt: "2026-10-12T00:00:00.000Z",
        sourceBranch: "feat/x",
        sourceVersion: "0.0.1",
        sourceCommit: "aaa111",
        baseBranch: "main",
        baseCommit: "bbb222",
        dataFormat: 1,
      }),
    ).toEqual({
      channel: "preview/feat-x",
      commit: "merge123",
      builtAt: "2026-10-12T00:00:00.000Z",
      sourceBranch: "feat/x",
      sourceVersion: "0.0.1",
      sourceCommit: "aaa111",
      baseBranch: "main",
      baseCommit: "bbb222",
      dataFormat: 1,
    });
  });

  it("leaves unknown sides null for old builds", () => {
    const f = buildUnvibeField({
      channel: "release",
      commit: "ccc333",
      builtAt: "2026-10-12T00:00:00.000Z",
      sourceBranch: null,
      sourceVersion: "0.0.1",
    });
    expect(f.sourceCommit).toBeNull();
    expect(f.baseBranch).toBeNull();
    expect(f.baseCommit).toBeNull();
  });
});

describe("selectPruneRefs (--prune)", () => {
  const entries = [
    { ref: "preview/feat-a", sourceBranch: "feat/a" },
    { ref: "preview/feat-b", sourceBranch: "feat/b" },
    { ref: "preview/main", sourceBranch: "main" },
    { ref: "preview/unknown", sourceBranch: null },
  ];

  it("selects merged and deleted source branches with reasons", () => {
    expect(selectPruneRefs(entries, ["feat/a"], ["main", "feat/a", "feat/b"])).toEqual([
      { ref: "preview/feat-a", reason: "merged" },
    ]);
    expect(selectPruneRefs(entries, [], ["main"])).toEqual([
      { ref: "preview/feat-a", reason: "source-branch deleted" },
      { ref: "preview/feat-b", reason: "source-branch deleted" },
    ]);
  });

  it("keeps the base's own preview and refs with unknown sources", () => {
    expect(selectPruneRefs(entries, ["main", "feat/a", "feat/b"], ["main", "feat/a", "feat/b"])).toEqual([
      { ref: "preview/feat-a", reason: "merged" },
      { ref: "preview/feat-b", reason: "merged" },
    ]);
  });

  it("never selects refs outside preview/", () => {
    const mixed = [
      ...entries,
      { ref: "release", sourceBranch: "feat/a" },
      { ref: "main", sourceBranch: "feat/a" },
      { ref: "../escape", sourceBranch: "feat/a" },
    ];
    expect(selectPruneRefs(mixed, ["feat/a"], ["main", "feat/a"])).toEqual([
      { ref: "preview/feat-a", reason: "merged" },
      { ref: "preview/feat-b", reason: "source-branch deleted" },
    ]);
  });
});

describe("preview publish dry-run ships release-notes.json (#330)", () => {
  it("includes the file in the built package, with the --notes-file entry merged", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const tmp = mkdtempSync(path.join(os.tmpdir(), "unvibe-preview-dryrun-"));
    const repo = path.join(tmp, "repo");
    const bin = path.join(tmp, "bin");
    const home = path.join(tmp, "home");
    mkdirSync(repo, { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(home, { recursive: true });
    const realNpm = spawnSync("which", ["npm"], { encoding: "utf8" }).stdout.trim();
    const env = { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
    delete (env as Record<string, string | undefined>).GITHUB_TOKEN;
    const run = (cwd: string, cmd: string, args: string[]) => {
      const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 120_000 });
      if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
      return (r.stdout ?? "").trim();
    };
    try {
      // Minimal source repo the real scripts can build.
      cpSync(path.join(root, "scripts"), path.join(repo, "scripts"), { recursive: true });
      writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "unvibe-test", version: "0.0.1" }) + "\n");
      writeFileSync(path.join(repo, "README.md"), "# test\n");
      writeFileSync(path.join(repo, "LICENSE"), "MIT\n");
      mkdirSync(path.join(repo, "prompts"), { recursive: true });
      writeFileSync(path.join(repo, "prompts", "p.md"), "prompt\n");
      mkdirSync(path.join(repo, "fixtures", "urllib3-5020"), { recursive: true });
      writeFileSync(path.join(repo, "fixtures", "urllib3-5020", "x.md"), "fixture\n");
      mkdirSync(path.join(repo, "packages", "shared", "src"), { recursive: true });
      writeFileSync(path.join(repo, "packages", "shared", "src", "data-format.ts"), "export const DATA_FORMAT = 1;\n");
      for (const dep of ["fastify", "@fastify/static", "@fastify/websocket", "@modelcontextprotocol/sdk", "immer", "ws"]) {
        mkdirSync(path.join(repo, "node_modules", dep), { recursive: true });
        writeFileSync(path.join(repo, "node_modules", dep, "package.json"), JSON.stringify({ name: dep, version: "1.0.0" }) + "\n");
      }
      // Stub npm: install/build create the dist shape release.mjs needs;
      // pack delegates to the real npm. Stub gh + mise: no network.
      writeFileSync(
        path.join(bin, "npm"),
        `#!/bin/sh\nif [ "$1" = "pack" ]; then exec "${realNpm}" "$@"; fi\nif [ "$1" = "install" ]; then exit 0; fi\nif [ "$1" = "run" ]; then\n  mkdir -p packages/service/dist/adapters packages/service/dist/grammars packages/web/dist\n  printf 'SERVICE_VERSION = "0.0.1"\\nMCP_SERVICE_VERSION = "0.0.1"\\n' > packages/service/dist/index.js\n  echo x > packages/service/dist/adapters/claude.js\n  echo x > packages/service/dist/adapters/codex.js\n  echo x > packages/service/dist/update-helper.js\n  echo '{"inputs":{}}' > packages/service/dist/meta.json\n  echo '{"inputs":{}}' > packages/service/dist/adapters/claude-meta.json\n  echo '{"inputs":{}}' > packages/service/dist/adapters/codex-meta.json\n  for g in web-tree-sitter tree-sitter-python tree-sitter-go tree-sitter-rust tree-sitter-java tree-sitter-ruby tree-sitter-javascript tree-sitter-typescript tree-sitter-tsx; do echo x > "packages/service/dist/grammars/$g.wasm"; done\n  echo '<html></html>' > packages/web/dist/index.html\n  echo '{"inputs":{}}' > packages/web/dist/web-meta.json\n  exit 0\nfi\nexit 0\n`,
        { mode: 0o755 },
      );
      writeFileSync(
        path.join(bin, "gh"),
        `#!/bin/sh\nif [ "$1" = "issue" ]; then echo '{"title":"Release notes inside every build","url":"https://github.com/indigoviolet/unvibe/issues/330"}'; exit 0; fi\nexit 1\n`,
        { mode: 0o755 },
      );
      writeFileSync(path.join(bin, "mise"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      run(repo, "git", ["init", "-q", "-b", "main"]);
      run(repo, "git", ["config", "user.email", "t@t"]);
      run(repo, "git", ["config", "user.name", "t"]);
      run(repo, "git", ["add", "-A"]);
      run(repo, "git", ["commit", "-qm", "init"]);
      run(repo, "git", ["checkout", "-qb", "feat/notes"]);
      writeFileSync(path.join(repo, "feature.txt"), "feature\n");
      run(repo, "git", ["add", "-A"]);
      run(repo, "git", ["commit", "-qm", "feature work"]);
      // Advance main so merging it into the branch is a real merge commit.
      run(repo, "git", ["checkout", "-q", "main"]);
      writeFileSync(path.join(repo, "main.txt"), "main\n");
      run(repo, "git", ["add", "-A"]);
      run(repo, "git", ["commit", "-qm", "main work"]);
      run(repo, "git", ["checkout", "-q", "feat/notes"]);
      run(repo, "git", ["merge", "--no-ff", "-m", "Merge pull request #330 from feat/notes", "main"]);
      run(repo, "git", ["checkout", "-q", "main"]);

      const notesFile = path.join(tmp, "notes.json");
      writeFileSync(
        notesFile,
        JSON.stringify({ "330": { whatChanged: "Builds ship notes.", whatToTry: "Open Version.", caveats: "Gates pending." } }),
      );
      // Dry run: no --push, so nothing leaves the machine.
      const pub = spawnSync(process.execPath, [path.join(repo, "scripts", "preview-publish.mjs"), "feat/notes", "--notes-file", notesFile], {
        cwd: repo,
        env,
        encoding: "utf8",
        timeout: 180_000,
      });
      expect(pub.status, `${pub.stdout}\n${pub.stderr}`).toBe(0);
      const shipped = run(repo, "git", ["show", "preview/feat-notes:release-notes.json"]);
      const notes = JSON.parse(shipped) as {
        channel: string;
        items: { number: number; whatChanged?: string; whatToTry?: string; caveats?: string }[];
      };
      expect(notes.channel).toBe("preview/feat-notes");
      expect(notes.items).toHaveLength(1);
      expect(notes.items[0]).toMatchObject({
        number: 330,
        whatChanged: "Builds ship notes.",
        whatToTry: "Open Version.",
        caveats: "Gates pending.",
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 240_000);
});

describe("assertPreviewDeleteRef", () => {
  it("accepts only preview/* refs", () => {
    expect(assertPreviewDeleteRef("preview/feat-x")).toBe("preview/feat-x");
    for (const bad of ["release", "main", "preview/", "preview/a/b", "", "../x"]) {
      expect(() => assertPreviewDeleteRef(bad), bad).toThrow();
    }
  });
});
