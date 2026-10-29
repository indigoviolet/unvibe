/**
 * `unvibe reset-data` (#311): the CLI form of the data-format reset.
 * Moves the data dir aside (never deletes it) and recreates it empty.
 * Refuses while the service is running — the running service owns the
 * store; stop it first. Confirmation comes from `--yes` or the
 * caller's prompt.
 */
import { checkDataFormat, moveDataAside } from "../data-format.js";
import { isPidAlive, readLock } from "./lock.js";

export const RESET_DATA_USAGE = [
  "unvibe reset-data: move data this version cannot read aside and start fresh",
  "",
  "Usage: unvibe reset-data [--yes]",
  "",
  "  --yes   confirm without a prompt",
  "",
  "The data directory is moved to a dated sibling (never deleted).",
  "Export unposted Outbox drafts from the app first — they are part of",
  "the moved data and the fresh start will not show them.",
  "Stop the service first (`unvibe stop`).",
].join("\n");

export interface ResetDataDeps {
  dataDir: string;
  yes: boolean;
  /** True when a live service holds the data dir. */
  isRunning: () => boolean;
  /** Interactive confirmation (only called without `--yes`). */
  confirm: () => Promise<boolean>;
}

export interface ResetDataOutcome {
  code: number;
  lines: string[];
}

/** True when the single-instance lock names a live process. */
export function serviceIsRunning(dataDir: string): boolean {
  const lock = readLock(dataDir);
  return lock !== null && isPidAlive(lock.pid);
}

export async function runResetDataFlow(deps: ResetDataDeps): Promise<ResetDataOutcome> {
  const status = checkDataFormat(deps.dataDir);
  if (status.state === "none") {
    return { code: 0, lines: ["no stored data yet — nothing to reset."] };
  }
  if (status.state === "match") {
    return {
      code: 0,
      lines: [`your data is format ${status.stored}, which this version reads — nothing to reset.`],
    };
  }
  if (deps.isRunning()) {
    return {
      code: 1,
      lines: [
        "the service is running and owns your data — stop it first, then reset:",
        "  unvibe stop",
        "  unvibe reset-data",
        "  unvibe start",
      ],
    };
  }
  if (!deps.yes) {
    const ok = await deps.confirm();
    if (!ok) {
      return { code: 1, lines: ["cancelled — nothing was moved. Re-run with --yes to confirm without a prompt."] };
    }
  }
  const movedTo = moveDataAside(deps.dataDir);
  return {
    code: 0,
    lines: [
      `moved your data to ${movedTo}`,
      "nothing was deleted — that copy stays on disk; remove it by hand when you no longer need it.",
      "run `unvibe start` to start fresh.",
    ],
  };
}
