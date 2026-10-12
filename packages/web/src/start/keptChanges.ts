/**
 * Kept PR/branch lists for the start page (issue #90).
 *
 * Web-only cache: the last successful `GET /api/repos/:id/changes` payloads
 * per repo live in `localStorage` (so a reload and a return to the start
 * page both show them) with an in-memory copy in front. The service is
 * untouched; the client stamps the fetch time itself.
 *
 * Storage key, shape and limits:
 * - key `unvibe.start.keptChanges.v1` (versioned; a version mismatch or a
 *   malformed entry is dropped, never thrown on);
 * - shape `{ version: 1, viewer: string | null, repos: Record<repoId,
 *   { authoring, requested, branches, fetchNote, fetchedAt }> }`;
 * - at most the last 10 repos (oldest `fetchedAt` evicted first);
 * - `localStorage` unavailable or full: carry on with the in-memory copy.
 */
import type { RepoChange } from "@unvibe/shared";

/** Versioned key: bump to drop every kept entry at once. */
export const KEPT_CHANGES_KEY = "unvibe.start.keptChanges.v1";

/** How many repos are kept at most (oldest `fetchedAt` evicted first). */
export const MAX_KEPT_REPOS = 10;

export interface KeptLists {
  authoring: RepoChange[];
  requested: RepoChange[];
  branches: RepoChange[];
  fetchNote: string | null;
  fetchedAt: number;
}

type KeptInput = Omit<KeptLists, "fetchedAt">;

interface StoredEntry {
  authoring: unknown;
  requested: unknown;
  branches: unknown;
  fetchNote: unknown;
  fetchedAt: unknown;
}

interface StoredDoc {
  version: unknown;
  viewer: unknown;
  repos: unknown;
}

const KINDS = new Set(["pr", "branch", "review", "demo"]);

function isRepoChange(v: unknown): v is RepoChange {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  if (!KINDS.has(c.kind as string)) return false;
  if (typeof c.title !== "string") return false;
  if (c.prNumber !== undefined && typeof c.prNumber !== "number") return false;
  if (c.branch !== undefined && typeof c.branch !== "string") return false;
  if (c.author !== undefined && typeof c.author !== "string") return false;
  if (c.updatedAt !== undefined && typeof c.updatedAt !== "number") return false;
  if (c.reviewId !== undefined && typeof c.reviewId !== "string") return false;
  if (c.stale !== undefined && typeof c.stale !== "boolean") return false;
  if (c.demo !== undefined && typeof c.demo !== "string") return false;
  return true;
}

function isChangeList(v: unknown): v is RepoChange[] {
  return Array.isArray(v) && v.every(isRepoChange);
}

function toKeptLists(e: StoredEntry): KeptLists | null {
  if (!isChangeList(e.authoring)) return null;
  if (!isChangeList(e.requested)) return null;
  if (!isChangeList(e.branches)) return null;
  if (e.fetchNote !== null && e.fetchNote !== undefined && typeof e.fetchNote !== "string") return null;
  if (typeof e.fetchedAt !== "number" || !Number.isFinite(e.fetchedAt) || e.fetchedAt <= 0) return null;
  return {
    authoring: e.authoring,
    requested: e.requested,
    branches: e.branches,
    fetchNote: typeof e.fetchNote === "string" ? e.fetchNote : null,
    fetchedAt: e.fetchedAt,
  };
}

function readStorage(): { viewer: string | null; repos: Map<string, KeptLists> } {
  const empty = { viewer: null as string | null, repos: new Map<string, KeptLists>() };
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEPT_CHANGES_KEY);
  } catch {
    return empty;
  }
  if (!raw) return empty;
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return empty;
  }
  const d = doc as StoredDoc;
  if (typeof d !== "object" || d === null || d.version !== 1) return empty;
  if (typeof d.repos !== "object" || d.repos === null) return empty;
  const viewer = typeof d.viewer === "string" ? d.viewer : null;
  const repos = new Map<string, KeptLists>();
  for (const [id, entry] of Object.entries(d.repos as Record<string, unknown>)) {
    if (typeof id !== "string" || id === "" || id === "demo") continue;
    if (typeof entry !== "object" || entry === null) continue;
    const kept = toKeptLists(entry as StoredEntry);
    if (kept) repos.set(id, kept);
  }
  return { viewer, repos };
}

function writeStorage(viewer: string | null, repos: Map<string, KeptLists>): void {
  try {
    const doc = {
      version: 1,
      viewer,
      repos: Object.fromEntries(repos),
    };
    localStorage.setItem(KEPT_CHANGES_KEY, JSON.stringify(doc));
  } catch {
    // Unavailable or full (quota): the in-memory copy keeps serving this
    // page load; the next load simply starts without kept lists.
  }
}

// In-memory copy in front of localStorage. `null` = not loaded yet.
let mem: Map<string, KeptLists> | null = null;
let memViewer: string | null = null;
let memLoaded = false;

function ensureLoaded(): void {
  if (memLoaded) return;
  memLoaded = true;
  const stored = readStorage();
  mem = stored.repos;
  memViewer = stored.viewer;
}

function memMap(): Map<string, KeptLists> {
  ensureLoaded();
  return mem ?? (mem = new Map());
}

/** Last successful lists for a repo, or null when nothing usable is kept. */
export function getKeptLists(repoId: string): KeptLists | null {
  if (!repoId || repoId === "demo") return null;
  try {
    return memMap().get(repoId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Kept entry for the initially selected repo, read once. Never throws:
 * `localStorage` may be unavailable and the entry may be missing or
 * malformed. `repoKey` is the storage key holding the selected repo id
 * (the demo pseudo-repo never has a kept entry).
 */
export function initialKept(repoKey: string): { repoId: string | null; kept: KeptLists | null } {
  try {
    const saved = localStorage.getItem(repoKey);
    if (!saved || saved === "demo") return { repoId: null, kept: null };
    return { repoId: saved, kept: getKeptLists(saved) };
  } catch {
    return { repoId: null, kept: null };
  }
}

/**
 * Remember a fetch result, stamped with the client-side fetch time.
 * Only call with at least one successful filter (callers keep the old rows
 * for failed filters before calling).
 */
export function setKeptLists(repoId: string, input: KeptInput): KeptLists {
  const kept: KeptLists = { ...input, fetchedAt: Date.now() };
  if (!repoId || repoId === "demo") return kept;
  try {
    const m = memMap();
    m.set(repoId, kept);
    // Cap: evict the oldest entries beyond the limit.
    if (m.size > MAX_KEPT_REPOS) {
      const ordered = [...m.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
      for (let i = 0; i < m.size - MAX_KEPT_REPOS; i++) {
        m.delete(ordered[i][0]);
      }
    }
    writeStorage(memViewer, m);
  } catch {
    // Carry on with the in-memory copy (or without any cache at all).
  }
  return kept;
}

/** Forget one repo (removed repo, or test teardown). */
export function clearKeptLists(repoId: string): void {
  try {
    const m = memMap();
    if (!m.delete(repoId)) return;
    writeStorage(memViewer, m);
  } catch {
    // Ignore: caching is best effort.
  }
}

/** Drop kept entries for repos no longer in the repo list. */
export function pruneKeptLists(validIds: Iterable<string>): void {
  try {
    const valid = new Set(validIds);
    const m = memMap();
    let changed = false;
    for (const id of [...m.keys()]) {
      if (!valid.has(id)) {
        m.delete(id);
        changed = true;
      }
    }
    if (changed) writeStorage(memViewer, m);
  } catch {
    // Ignore.
  }
}

/** Forget everything (login changed, or test teardown). */
export function clearAllKeptLists(): void {
  try {
    memMap().clear();
    writeStorage(memViewer, memMap());
  } catch {
    // Ignore.
  }
}

/** Viewer login stored alongside the kept lists (`gh api user`). */
export function getKeptViewer(): string | null {
  try {
    ensureLoaded();
    return memViewer;
  } catch {
    return null;
  }
}

export function setKeptViewer(login: string | null): void {
  try {
    ensureLoaded();
    memViewer = login;
    writeStorage(memViewer, memMap());
  } catch {
    // Ignore.
  }
}

/** Reset the in-memory copy (tests only: forces a re-read from storage). */
export function __resetKeptForTests(): void {
  mem = null;
  memViewer = null;
  memLoaded = false;
}

function ageWord(ms: number): string {
  if (ms < 60_000) return "just now";
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)} h ago`;
  if (ms < 86400_000 * 30) return `${Math.floor(ms / 86400_000)} d ago`;
  return "a while ago";
}

/**
 * Short plain status line for the kept lists ("Updated 3 min ago ·
 * refreshing…"). Sentence case, no jargon. Null when there is nothing kept
 * to describe.
 */
export function keptStatusText(fetchedAt: number | null, refreshing: boolean, now = Date.now()): string | null {
  if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;
  const age = ageWord(Math.max(0, now - fetchedAt));
  return refreshing ? `Updated ${age} · refreshing…` : `Updated ${age}`;
}
