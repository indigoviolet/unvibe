/**
 * Extension worker status (#322 install help): last background-worker
 * call time, held in memory only (no polling, no persistence). Plus the
 * shipped extension folder path and the OS open-folder command, run
 * through the injectable command runner (tests stub it).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isExtensionConnected } from "@unvibe/shared";
import type { CommandRunner } from "../exec/runner.js";

let lastWorkerCallAt: number | null = null;

export function noteWorkerCall(at: number = Date.now()): void {
  lastWorkerCallAt = at;
}
export function lastWorkerCall(): number | null {
  return lastWorkerCallAt;
}
export function workerConnected(now: number = Date.now()): boolean {
  return isExtensionConnected(lastWorkerCallAt, now);
}
/** Test seam. */
export function resetWorkerStatus(): void {
  lastWorkerCallAt = null;
}

/**
 * The shipped `extension/` folder. From `src/panel/` (dev/tests) and
 * from the bundled `dist/index.js` (installed package) the repo/package
 * root is three levels up; `extension/` sits beside `packages/` there.
 */
export function extensionFolderPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "..", "..", "extension"),
    path.resolve(here, "..", "..", "extension"),
    path.resolve(process.cwd(), "extension"),
  ];
  return candidates[0];
}

/** OS open-folder command (macOS `open`, Linux `xdg-open`). */
export function openFolderCommand(platform: string, folder: string): { cmd: string; args: string[] } {
  return platform === "darwin" ? { cmd: "open", args: [folder] } : { cmd: "xdg-open", args: [folder] };
}

export async function openExtensionFolder(
  runner: CommandRunner,
  opts: { platform?: string; folder?: string } = {},
): Promise<{ cmd: string; args: string[] }> {
  const { cmd, args } = openFolderCommand(opts.platform ?? process.platform, opts.folder ?? extensionFolderPath());
  const r = await runner.run(cmd, { args });
  if (r.code !== 0) throw new Error(`could not open the extension folder (${cmd} exited ${r.code})`);
  return { cmd, args };
}
