/**
 * Rule-based "uninteresting" pre-classification (ingest, PRD §20). The
 * implementation lives in `@unvibe/shared` (`src/diff.ts`); this module
 * re-exports it under the ingest path the service tests import.
 */
export { uninterestingReason } from "@unvibe/shared";
export type { UninterestingOptions } from "@unvibe/shared";
