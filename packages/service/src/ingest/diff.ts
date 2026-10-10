/**
 * Unified-diff parser (ingest, PRD §11.1). The implementation lives in
 * `@unvibe/shared` (`src/diff.ts`) so the service and the web mock share
 * one copy; this module re-exports it under the ingest paths the service
 * tests import.
 */
export { parseUnifiedDiff } from "@unvibe/shared";
export type { HunkLine as ParsedHunkLine, ParsedFile, ParsedHunk } from "@unvibe/shared";
