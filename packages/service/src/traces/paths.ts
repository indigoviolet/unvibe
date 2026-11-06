/** Local trace store paths (issue #356). */
import fs from "node:fs";
import path from "node:path";

/** Safety cap: stop recording past this many stored bytes (no deletion). */
export const TRACE_SAFETY_CAP_BYTES = 256 * 1024 * 1024;

/** `<dataDir>/traces/` — created on first write, never rotated. */
export function tracesDir(dataDir: string): string {
  return path.join(dataDir, "traces");
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
