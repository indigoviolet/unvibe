/**
 * Issue #105: agent sessions fail to start when the reviewed repo has a
 * mise config and the agent CLI is a mise shim.
 *
 * Reproduction without mise installed: a fake shim (POSIX `sh`, no
 * GNU-only flags, temp dirs via `node:os`/`node:path` so it passes on
 * macOS and Linux) that exits 1 with a mise-like "not trusted" message
 * when its working directory (or a parent) contains a marker file, and
 * otherwise behaves like the real agent binary. A temp directory shaped
 * like a review worktree holds the marker; a fake `mise` answers
 * `mise which <tool>` with the real path.
 *
 * The test drives the production binary choice (`diagnoseTool`, the same
 * choice the adapter startup and readiness/Doctor use) and then runs the
 * chosen binary from the worktree-shaped directory — the way a session
 * would. Before the fix the choice is the shim and the run fails; after
 * the fix the choice is the resolved real path and the run succeeds.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diagnoseTool, TOOL_SPECS } from "../src/diagnostics/tools.js";
import { RealCommandRunner } from "../src/exec/runner.js";

const MARKER = ".unvibe-shim-marker";

interface FakeTree {
  root: string;
  shimDir: string;
  managersDir: string;
  worktree: string;
  real: Record<"claude" | "codex", string>;
  shim: Record<"claude" | "codex", string>;
  pathValue: string;
}

function writeExec(file: string, body: string): string {
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

/**
 * Build the fake world. The shims walk up from $PWD looking for MARKER
 * (like mise finding an untrusted config in the worktree) and fail with
 * the reported error text; otherwise they report a version for
 * `--version` like the real CLIs.
 */
function makeFakeTree(): FakeTree {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-shim105-"));
  const realDir = path.join(root, "real");
  const shimDir = path.join(root, "shims");
  const managersDir = path.join(root, "managers");
  const worktree = path.join(root, "worktree");
  for (const d of [realDir, shimDir, managersDir, worktree]) fs.mkdirSync(d, { recursive: true });

  const real = {
    claude: writeExec(path.join(realDir, "claude-real"), "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'claude 2.1.296'; exit 0; fi\necho ok\n"),
    codex: writeExec(path.join(realDir, "codex-real"), "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'codex 0.162.1'; exit 0; fi\necho ok\n"),
  };

  const shimBody = (realBin: string, tool: string, version: string): string =>
    `#!/bin/sh\ndir="$PWD"\nwhile [ "$dir" != "/" ]; do\n  if [ -e "$dir/${MARKER}" ]; then\n    echo "mise ERROR Config files in $dir/.mise.toml are not trusted." >&2\n    echo "Trust them with \`mise trust\`." >&2\n    exit 1\n  fi\n  dir=$(dirname "$dir")\ndone\nif [ "$1" = "--version" ]; then echo '${tool} ${version}'; exit 0; fi\nexec "${realBin}" "$@"\n`;
  const shim = {
    claude: writeExec(path.join(shimDir, "claude"), shimBody(real.claude, "claude", "2.1.296")),
    codex: writeExec(path.join(shimDir, "codex"), shimBody(real.codex, "codex", "0.162.1")),
  };

  // Fake `mise`: answers `which <tool>` with the real path from a neutral
  // directory, like `mise which` bypassing shims (see docs, issue #105).
  writeExec(
    path.join(managersDir, "mise"),
    `#!/bin/sh\nif [ "$1" = "which" ]; then\n  case "$2" in\n    claude) echo "${real.claude}" ;;\n    codex) echo "${real.codex}" ;;\n    *) exit 1 ;;\n  esac\n  exit 0\nfi\nexit 1\n`,
  );

  // Worktree-shaped directory: the reviewed repo's config is untrusted
  // here (the marker stands in for it; the shim refuses to run under it).
  fs.writeFileSync(path.join(worktree, MARKER), "untrusted review config");
  fs.writeFileSync(path.join(worktree, ".mise.toml"), '[tools]\nnode = "24"\n');

  return { root, shimDir, managersDir, worktree, real, shim, pathValue: `${shimDir}${path.delimiter}${managersDir}` };
}

describe("issue #105: version-manager shim + untrusted review config", () => {
  for (const tool of ["claude", "codex"] as const) {
    it(`${tool}: the binary chosen for a session runs from a worktree-like directory`, async () => {
      const tree = makeFakeTree();
      try {
        const runner = new RealCommandRunner();
        const spec = TOOL_SPECS.find((s) => s.tool === tool)!;
        const diag = await diagnoseTool(spec, {
          pathValue: tree.pathValue,
          env: {},
          runner,
          timeoutMs: 8000,
        });
        expect(diag.chosen).toBe(tree.real[tool]);
        // The session runs the chosen binary with the review worktree as
        // its working directory: it must start there.
        const res = await runner.run(diag.chosen!, { args: ["--version"], cwd: tree.worktree, timeoutMs: 8000 });
        expect(res.code).toBe(0);
      } finally {
        fs.rmSync(tree.root, { recursive: true, force: true });
      }
    });
  }
});
