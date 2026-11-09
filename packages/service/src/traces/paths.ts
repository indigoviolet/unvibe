/**
 * Local trace store paths (issue #356; relocated per owner decision).
 *
 * The store lives in a sibling directory, `<dataDir>-traces`, rather
 * than inside the data dir: `unvibe reset-data` and the reset notice
 * move only the data dir aside, so traces survive resets (and version
 * switches, which keep the data dir) until the user presses Clear.
 * A sibling keeps one store per data dir — parallel services,
 * worktrees and test runs never share a file or a size cap — and is
 * trivially path-safe (a plain suffix, no new segments to sanitize).
 * `<parent>/unvibe-traces` was rejected for exactly that sharing
 * reason: every data dir under one parent would collide in one store.
 */
import fs from "node:fs";
import path from "node:path";

/** Safety cap: stop recording past this many stored bytes (no deletion). */
export const TRACE_SAFETY_CAP_BYTES = 256 * 1024 * 1024;

/** `<dataDir>-traces/` — created on first write, never rotated. */
export function tracesDir(dataDir: string): string {
  return `${dataDir}-traces`;
}

/** Append-only spans file: one OTLP/JSON span object per line. */
export function spansFile(dataDir: string): string {
  return path.join(tracesDir(dataDir), "spans.jsonl");
}

/** Ensure the traces dir exists and return it. */
export function ensureTracesDir(dataDir: string): string {
  const dir = tracesDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
