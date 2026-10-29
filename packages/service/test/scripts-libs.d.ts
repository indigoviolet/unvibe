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
    dataFormat: number | null;
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
    dataFormat?: number | null;
  }): UnvibeField;
  export function selectPruneRefs(
    entries: { ref: string; sourceBranch?: string | null }[],
    mergedBranches: string[],
    existingBranches: string[],
    mainName?: string,
  ): { ref: string; reason: string }[];
}

declare module "*release-notes-lib.mjs" {
  export function parseDataFormat(source: string | null | undefined): number | null;
  export function dataResetSection(prevFormat: number | null, nextFormat: number | null, version: string): string | null;
}

declare module "*global-install-lib.mjs" {
  export function platformBinaryPackages(platform?: string, arch?: string): string[];
  // The lib runtime-checks its inputs (non-objects answer null/false),
  // so callers may pass malformed values on purpose in tests.
  export function findRepoByPath<T>(repos: readonly T[] | null | undefined, localPath: string): T | null;
  export function isParserOutline(outline: unknown): boolean;
}

declare module "*demo-large-lib.mjs" {
  export const DEMO_LARGE_SCHEMA_VERSION: number;
  export const DEMO_LARGE_BUILD_CAP_USD: number;
  export const DEMO_LARGE_OPEN_CAP_USD: number;
  export const DEMO_LARGE_MODEL: { provider: string; model: string };
  export function demoLargeCacheDir(homeDir?: string): string;
  export function demoLargeMetaPath(cacheDir: string): string;
  export const DEMO_LARGE_CACHE_ENTRIES: string[];
  export function managedClonePath(dataDir: string, owner: string, name: string): string;
  export function normalizeRepoUrl(repo: string): { url: string; owner: string; name: string };
  export function writeDemoLargeMeta(cacheDir: string, meta: Record<string, unknown>): Record<string, unknown>;
  export function readDemoLargeMeta(cacheDir: string): Record<string, unknown> & {
    schemaVersion: number;
    reviewId: string;
  };
  export function copyCacheToScratch(cacheDir: string, dataDir: string): string[];
  export function rewriteManagedPaths(db: { prepare(sql: string): unknown }, dataDir: string): number;
  export function worktreeGitdirPointers(
    worktreePath: string,
    clonePath: string,
    worktreeName: string,
  ): {
    worktreeGitFile: { file: string; want: string };
    adminGitFile: { file: string; want: string };
  };
  export function rewriteWorktreePointers(worktreePath: string, clonePath: string, worktreeName: string): void;
  export function worktreeHealthy(worktreePath: string): string | null;
  export function repairWorktrees(dataDir: string): number;
  export function parseDemoLargeBuildArgs(argv: string[]): {
    repo: string | null;
    pr: number;
    capUsd: number;
    port: number;
    allowUnpriced: boolean;
    force: boolean;
    budgetMin: number;
  };
  export function parseDemoLargeOpenArgs(argv: string[]): { mode: string; port: number | null; capUsd: number };
}

declare module "*live-pi-lib.mjs" {
  export interface LivePick {
    provider: string;
    model: string;
  }
  export interface CostRates {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  }
  export interface TokenUsage {
    inputTokens?: number;
    cachedReadTokens?: number;
    cachedTokens?: number;
    cachedWriteTokens?: number;
    outputTokens?: number;
  }
  export interface CatalogEntry {
    provider?: string;
    id?: string;
    name?: string;
    cost?: Partial<CostRates>;
    contextWindow?: number;
    maxTokens?: number;
  }
  export interface SpendTracker {
    totals: { inputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; outputTokens: number };
    add(usage: TokenUsage): { inputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; outputTokens: number };
    usd(): number;
    check(what?: string): number;
  }
  export const LIVE_PI_DEFAULT: LivePick;
  export function parseLiveArgs(argv: string[]): LivePick & { capUsd: number; allowUnpriced: boolean };
  export function splitModelRef(ref: string): { provider: string | null; id: string };
  export function resolvePiCmd(env?: NodeJS.ProcessEnv): string[];
  export function runPiListModels(piCmd: string[], pattern: string, opts?: { env?: NodeJS.ProcessEnv; timeoutMs?: number }): string;
  export function parseListModels(output: string): { provider: string; model: string }[];
  export function precheckModelOffered(
    piCmd: string[],
    pick: LivePick,
    opts?: { env?: NodeJS.ProcessEnv },
  ): { provider: string; model: string };
  export function fetchPiCatalog(piCmd: string[], opts?: { env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<CatalogEntry[]>;
  export function findCatalogEntry(catalog: CatalogEntry[], pick: LivePick): CatalogEntry | null;
  export function assertPriced(
    entry: CatalogEntry | null | undefined,
    opts: LivePick & { allowUnpriced?: boolean },
  ): CostRates;
  export function costOf(usage: TokenUsage, rates: CostRates): number;
  export function formatUsd(n: number): string;
  export function worstCaseTurnUsd(rates: CostRates, entry: CatalogEntry | null | undefined): number | null;
  export function preflightCap(args: { capUsd: number; worstCaseUsd: number | null; what?: string }): number | null;
  export function createSpendTracker(rates: CostRates, capUsd: number): SpendTracker;
  export function liveModelPatch(pick: LivePick, roles?: string[]): Record<string, LivePick>;
  export function selectLiveModel(
    putSettings: (patch: Record<string, LivePick>) => Promise<{ ok: boolean; status: number; detail: string; body: unknown }>,
    pick: LivePick,
    roles?: string[],
  ): Promise<unknown>;
  export function writeLiveReport(args: { dir: string; task: string } & Record<string, unknown>): string;
}
