/**
 * Types for the plain-ESM script libraries the service tests import
 * directly (`scripts/*.mjs` have no declarations of their own). Kept with
 * the tests so the .mjs sources stay dependency-free; signatures mirror
 * the implementations and their JSDoc.
 */

declare module "*preview-lib.mjs" {
  export function branchSlug(branch: string | null | undefined): string;
  export function isPrereleaseIdentifier(id: string): boolean;
  export function previewVersion(base: string, slug: string, shortsha: string): string;
  export function isValidPreviewVersion(version: string): boolean;
  export function previewRef(slug: string): string;
  export function isPreviewRef(ref: string): boolean;
  export function previewPushRefspec(slug: string): string;
  export function assertPreviewPushRefspec(refspec: string): string;
  export function assertPreviewDeleteRef(ref: string): string;
  export interface WorktreeEntry {
    path: string;
    branch: string | null;
    detached: boolean;
  }
  export function parseWorktreeList(output: string): WorktreeEntry[];
  export function resolveWorktree(output: string, branch: string): string | null;
  export function selectAllBranches(allBranches: string[], aheadBranches: string[], mainName?: string): string[];
  export interface UnvibeField {
    channel: string;
    commit: string;
    builtAt: string;
    sourceBranch: string;
    sourceVersion: string;
    sourceCommit: string | null;
    baseBranch: string | null;
    baseCommit: string | null;
  }
  export function buildUnvibeField(field: {
    channel: string;
    commit: string;
    builtAt: string;
    sourceBranch: string | null;
    sourceVersion: string;
    sourceCommit?: string | null;
    baseBranch?: string | null;
    baseCommit?: string | null;
  }): UnvibeField;
  export function selectPruneRefs(
    entries: { ref: string; sourceBranch?: string | null }[],
    mergedBranches: string[],
    existingBranches: string[],
    mainName?: string,
  ): { ref: string; reason: string }[];
}

declare module "*global-install-lib.mjs" {
  export function platformBinaryPackages(platform?: string, arch?: string): string[];
  // The lib runtime-checks its inputs (non-objects answer null/false),
  // so callers may pass malformed values on purpose in tests.
  export function findRepoByPath<T>(repos: readonly T[] | null | undefined, localPath: string): T | null;
  export function isParserOutline(outline: unknown): boolean;
}
