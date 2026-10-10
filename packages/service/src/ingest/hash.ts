/**
 * Hunk content hash (PRD §8). The implementation lives in `@unvibe/shared`
 * (`src/diff.ts`, self-contained sync SHA-256 so browsers hash identically);
 * this module re-exports it under the ingest path the service tests import.
 */
export { HUNK_HASH_LEN, hashHunkLines, hunkHashInput, normaliseHunkLine, sha256HexUtf8 } from "@unvibe/shared";
