/*global console process */
// Shared per-run temp-root helper (issue #24): one fresh directory per
// script run; everything the script creates goes under it and is removed
// by exact path — including on failure and on SIGINT/SIGTERM. Never
// globs the system temp dir: other worktrees' suites share it.
//
// Usage:
//   import { createRunRoot, removeDir, onExit } from "./tmp-guard.mjs";
//   const RUN = createRunRoot("unvibe-test-");
//   const HOME = ... // mkdir under RUN
//   onExit(() => { stopOwnDaemons(); removeDir(RUN); });
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Fresh per-run root directly under the system temp dir. */
export function createRunRoot(prefix = "unvibe-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Best-effort recursive removal by exact path (portable: no shell). */
export function removeDir(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

/**
 * Run `fn` once on normal exit and on SIGINT/SIGTERM (sync only — async
 * work cannot complete there). Handlers chain: multiple `onExit` calls
 * each run once, in registration order.
 */
export function onExit(fn) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    try {
      fn();
    } catch (e) {
      console.error(`cleanup: ${String(e).slice(0, 200)}`);
    }
  };
  process.once("exit", run);
  process.once("SIGINT", () => {
    run();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    run();
    process.exit(143);
  });
}
