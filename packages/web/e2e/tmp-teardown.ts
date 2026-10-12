/**
 * Playwright global teardown (issue #24): remove the per-run temp root
 * created in `playwright.config.ts` by exact path, even when specs fail.
 *
 * Guard (trap-safe): only entries under this run's own root are judged.
 * Other worktrees' suites share the system temp dir; their roots and
 * entries are never listed or touched. A leftover here means a spec's
 * `afterAll` did not run (worker crash) — fail loudly so it is noticed,
 * after removing what we can.
 */
import fs from "node:fs";

async function teardown(): Promise<void> {
  const root = process.env.UNVIBE_E2E_TMPROOT;
  if (!root) return;
  let entries: string[] = [];
  try {
    // Only `unvibe-*` entries are ours to judge (issue #24): the Node
    // runtime shares TMPDIR and may leave a `node-compile-cache` behind.
    entries = fs.readdirSync(root).filter((e) => e.startsWith("unvibe-"));
  } catch {
    return;
  }
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // best effort
  }
  if (entries.length > 0) {
    throw new Error(
      `unvibe temp guard (#24): ${entries.length} entr(ies) left in the per-run root ${root}: ${entries.slice(0, 10).join(", ")}`,
    );
  }
}

export default teardown;
