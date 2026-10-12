/**
 * Native folder picker (#26): open a "choose folder" dialog on the user's
 * own machine and report the outcome.
 *
 * A browser folder picker cannot supply an absolute path, so the dialog
 * runs service-side through the injectable command runner (tests stub
 * `git`/`gh` through the same seam; nothing here touches `child_process`
 * directly and this module never launches a dialog in tests):
 * - macOS: `osascript -e 'activate' -e 'POSIX path of (choose folder)'`.
 *   The leading `activate` targets only the script's own process, pulling
 *   the dialog in front of other windows when the service runs in the
 *   background; it addresses no other app, so it needs neither Automation
 *   nor Accessibility consent (unlike `tell application "Finder"` /
 *   `"System Events"` forms, which prompt on first use). User cancel is
 *   a non-zero exit whose stderr mentions -128: reported as "cancelled".
 * - Linux: `zenity --file-selection --directory`, falling back to
 *   `kdialog --getexistingdirectory`. Cancel is exit 1 with empty output.
 *   With no `DISPLAY`/`WAYLAND_DISPLAY`, or when neither tool exists, the
 *   result is "unavailable" — the display check runs before spawning
 *   anything so a headless service never hangs on a dialog.
 * - Other platforms: "unavailable".
 *
 * The dialog blocks until the user acts, so callers pass no `timeoutMs`
 * (a short timeout would cut the request off mid-dialog). Concurrency is
 * guarded per app in the route: a second pick while one is open gets 409
 * instead of stacking dialogs. The `await` never blocks the event loop,
 * so the service stays responsive to other requests meanwhile.
 *
 * The returned path is trimmed (trailing newline, plus osascript's
 * trailing slash) but never validated as a git repo here; adding it still
 * goes through `POST /api/repos`.
 */
import type { PickFolderResponse } from "@unvibe/shared";
import type { CommandRunner, RunResult } from "../exec/index.js";

export interface PickFolderOptions {
  /** Defaults to `process.platform`. Injectable so both branches are unit-tested on Linux CI. */
  platform?: NodeJS.Platform;
  /** Defaults to `process.env`. Injectable for the no-display case. */
  env?: NodeJS.ProcessEnv;
}

const OSASCRIPT_ARGS = ["-e", "activate", "-e", "POSIX path of (choose folder)"];
const ZENITY_ARGS = ["--file-selection", "--directory"];
const KDIALOG_ARGS = ["--getexistingdirectory"];

/** osascript `choose folder` output keeps a trailing slash (`/a/b/`); root stays `/`. */
function trimPickedPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length > 1 && trimmed.endsWith("/")) return trimmed.slice(0, -1);
  return trimmed;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function pickMacOS(runner: CommandRunner): Promise<PickFolderResponse> {
  let res: RunResult;
  try {
    // No timeoutMs: the dialog blocks until the user acts.
    res = await runner.run("osascript", { args: OSASCRIPT_ARGS });
  } catch (err) {
    return {
      status: "unavailable",
      reason: `couldn't open the folder dialog (${message(err)}); type the path instead`,
    };
  }
  if (res.code !== 0) {
    // User cancel is error -128 ("User canceled.").
    if (/-128|user canceled/i.test(`${res.stderr}\n${res.stdout}`)) return { status: "cancelled" };
    const detail = res.stderr.trim().slice(0, 120);
    return {
      status: "unavailable",
      reason: detail
        ? `the folder dialog failed (${detail}); type the path instead`
        : "the folder dialog failed; type the path instead",
    };
  }
  const picked = trimPickedPath(res.stdout);
  if (picked === "") return { status: "cancelled" };
  return { status: "picked", path: picked };
}

/** Run one Linux dialog tool: "missing" when the binary is not installed. */
async function tryTool(
  runner: CommandRunner,
  cmd: string,
  args: string[],
): Promise<RunResult | "missing"> {
  try {
    // No timeoutMs: the dialog blocks until the user acts.
    const res = await runner.run(cmd, { args });
    // 127 is the "command not found" convention; a direct spawn surfaces a
    // missing binary as a rejection instead, handled below.
    if (res.code === 127) return "missing";
    return res;
  } catch {
    return "missing";
  }
}

/** Shared result mapping for zenity/kdialog: only exit 0 with a path is a pick; exit 1 is cancel. */
function fromToolResult(res: RunResult, tool: string): PickFolderResponse {
  const picked = res.stdout.trim();
  if (res.code === 0 && picked !== "") return { status: "picked", path: picked };
  if (res.code === 0 || res.code === 1) return { status: "cancelled" };
  const detail = res.stderr.trim().slice(0, 120);
  return {
    status: "unavailable",
    reason: detail
      ? `the folder dialog (${tool}) failed (${detail}); type the path instead`
      : `the folder dialog (${tool}) failed; type the path instead`,
  };
}

async function pickLinux(
  runner: CommandRunner,
  env: NodeJS.ProcessEnv,
): Promise<PickFolderResponse> {
  const display = (env["DISPLAY"] ?? "").trim();
  const wayland = (env["WAYLAND_DISPLAY"] ?? "").trim();
  if (display === "" && wayland === "") {
    return {
      status: "unavailable",
      reason: "no display found (DISPLAY and WAYLAND_DISPLAY are unset); type the path instead",
    };
  }
  const zenity = await tryTool(runner, "zenity", ZENITY_ARGS);
  if (zenity !== "missing") return fromToolResult(zenity, "zenity");
  const kdialog = await tryTool(runner, "kdialog", KDIALOG_ARGS);
  if (kdialog !== "missing") return fromToolResult(kdialog, "kdialog");
  return {
    status: "unavailable",
    reason: "no folder dialog tool found (install zenity or kdialog); type the path instead",
  };
}

export async function pickFolder(
  runner: CommandRunner,
  opts: PickFolderOptions = {},
): Promise<PickFolderResponse> {
  const platform = opts.platform ?? process.platform;
  if (platform === "darwin") return pickMacOS(runner);
  if (platform === "linux") return pickLinux(runner, opts.env ?? process.env);
  return {
    status: "unavailable",
    reason: `the folder picker runs on macOS and Linux only (this service runs on ${platform}); type the path instead`,
  };
}
