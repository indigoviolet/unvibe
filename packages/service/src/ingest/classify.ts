/**
 * File classification + file keys (ingest, PRD §11.1). The implementation
 * lives in `@unvibe/shared` (`src/diff.ts`); this module re-exports it
 * under the ingest path the service tests import.
 */
export { classifyFile, fileKeyForPath } from "@unvibe/shared";
export type { ClassifyOptions } from "@unvibe/shared";
