/**
 * Hunk content hash (PRD §8).
 *
 * Stable across versions: ignores line numbers (they shift on every push)
 * and whitespace (indentation churn must not clear hunk state). Any real
 * content change — including add↔del↔ctx kind flips — hashes differently.
 *
 * Normalisation per row: `kind + ":" + text with ALL whitespace removed`
 * (`\s+` → ""), rows joined with `\n`, then SHA-256 hex, truncated to 16
 * chars for readable `h:<fileKey>:<hash>` IDs (64 bits: collision risk is
 * negligible within one review).
 */
import { createHash } from "node:crypto";
import type { ParsedHunkLine } from "./diff.js";

export const HUNK_HASH_LEN = 16;

/** Normalise one row for hashing: kind + whitespace-stripped text. */
export function normaliseHunkLine(line: ParsedHunkLine): string {
  return `${line.kind}:${line.text.replace(/\s+/g, "")}`;
}

/** Canonical hash input for a hunk's rows (exposed for tests/debugging). */
export function hunkHashInput(lines: ParsedHunkLine[]): string {
  return lines.map(normaliseHunkLine).join("\n");
}

/** Content hash for a hunk's rows. */
export function hashHunkLines(lines: ParsedHunkLine[]): string {
  return createHash("sha256").update(hunkHashInput(lines), "utf8").digest("hex").slice(0, HUNK_HASH_LEN);
}
