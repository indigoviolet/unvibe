/**
 * Web-document spike (#322 part 2): a github.com page is the document,
 * one thread per page, answers may cite several active repos.
 * Pure logic only — caps, page keys, repo-qualified citations, repo picks.
 */

/** Hard caps: nothing beyond these ever leaves the page (design doc §2). */
export const WEBDOC_CAPS = {
  selectionChars: 2_000,
  contextChars: 8_000,
  titleChars: 300,
  questionChars: 4_000,
} as const;

export interface PageCapture {
  url: string;
  title: string;
  selection: string;
  /** Capped window of main text around the selection (or page start). */
  context: string;
  capturedAt: number;
}

export interface ActiveRepoRef {
  id: string;
  owner: string;
  name: string;
  localPath: string;
}

export function repoSlug(r: Pick<ActiveRepoRef, "owner" | "name">): string {
  return `${r.owner}/${r.name}`;
}

/** One thread per page: scheme+host lower-cased, no fragment, no trailing slash. */
export function pageKey(rawUrl: string): string {
  const u = new URL(rawUrl);
  u.hash = "";
  u.search = "";
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${u.protocol}//${u.host.toLowerCase()}${path}`;
}

export function isGitHubPage(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).hostname.toLowerCase() === "github.com";
  } catch {
    return false;
  }
}

/** Clamp a raw capture to the caps; selection is kept verbatim (trimmed). */
export function capPageCapture(input: PageCapture): PageCapture {
  return {
    url: input.url.slice(0, 2_000),
    title: input.title.slice(0, WEBDOC_CAPS.titleChars),
    selection: input.selection.trim().slice(0, WEBDOC_CAPS.selectionChars),
    context: input.context.slice(0, WEBDOC_CAPS.contextChars),
    capturedAt: input.capturedAt,
  };
}

/**
 * Repo-qualified code citation, the multi-repo form of `code:`:
 * `code:<owner>/<name>:<path>:<start>-<end>` e.g.
 * `code:acme/service:src/auth.ts:12-18`. The slug has exactly one `/`
 * and no colon, so the path (which may contain colons on no platform we
 * support in citations) stays unambiguous to split from the right.
 */
export function repoCodeCitation(repo: Pick<ActiveRepoRef, "owner" | "name">, path: string, start: number, end: number): string {
  return `code:${repoSlug(repo)}:${path}:${start}-${end}`;
}

export interface ParsedRepoCitation { slug: string; path: string; start: number; end: number }

export function parseRepoCodeCitation(token: string): ParsedRepoCitation | null {
  const m = /^code:([^:\s]+)\/([^:\s]+):(.+):(\d+)-(\d+)$/.exec(token.trim());
  if (!m) return null;
  return { slug: `${m[1]}/${m[2]}`, path: m[3], start: Number(m[4]), end: Number(m[5]) };
}

/** Rough token estimate for the cost line (4 chars/token, design doc §2). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface RepoHit { repoId: string; slug: string; path: string; line: number; text: string }

/**
 * Repos an answer used: every repo with at least one hit, in hit order.
 * Several repos are expected (a service and its client in one answer).
 */
export function reposUsed(hits: readonly RepoHit[]): string[] {
  const seen: string[] = [];
  for (const h of hits) if (!seen.includes(h.slug)) seen.push(h.slug);
  return seen;
}

/** Search terms from a question + selection: identifiers and long words. */
export function questionTerms(question: string, selection = ""): string[] {
  const raw = `${question} ${selection}`.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [];
  const stop = new Set(["the", "and", "for", "how", "does", "what", "where", "which", "this", "that", "with", "from"]);
  return [...new Set(raw.filter((t) => !stop.has(t.toLowerCase())))].slice(0, 12);
}

export interface PanelThreadMessage {
  role: "user" | "assistant";
  text: string;
  citations: string[];
  reposUsed: string[];
  reads: { slug: string; path: string }[];
  at: number;
}

export interface PanelThread {
  pageKey: string;
  url: string;
  title: string;
  messages: PanelThreadMessage[];
}
