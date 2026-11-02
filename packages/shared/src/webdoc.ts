/**
 * Web-document panel (#322 part 2): a web page is the document, one
 * thread per page, answers may cite several active repos.
 * Pure logic only — caps, page keys, hashes, staleness, citations.
 */
import { sha256HexUtf8 } from "./diff.js";

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

/** One thread per page: scheme+host lower-cased, no fragment/query, no trailing slash. */
export function pageKey(rawUrl: string): string {
  const u = new URL(rawUrl);
  u.hash = "";
  u.search = "";
  const p = u.pathname.replace(/\/+$/, "") || "/";
  return `${u.protocol}//${u.host.toLowerCase()}${p}`;
}

export function capPageCapture(input: PageCapture): PageCapture {
  return {
    url: input.url.slice(0, 2_000),
    title: input.title.slice(0, WEBDOC_CAPS.titleChars),
    selection: input.selection.trim().slice(0, WEBDOC_CAPS.selectionChars),
    context: input.context.slice(0, WEBDOC_CAPS.contextChars),
    capturedAt: input.capturedAt,
  };
}

/** Content hash of a capture (context text) for staleness checks. */
export function captureHash(context: string): string {
  return sha256HexUtf8(context);
}

/** True when a stored quote is still findable on the (possibly changed) page. */
export function quoteOnPage(quote: string, pageText: string): boolean {
  const q = quote.trim().replace(/\s+/g, " ");
  if (!q) return false;
  return pageText.replace(/\s+/g, " ").includes(q);
}

/** Label shown when a clicked quote is gone (#322 owner answer 5). */
export const QUOTE_GONE_LABEL = "not on the page any more";

/** What clicking a quote does: found scrolls, missing shows the gone label. */
export function quoteClickResult(quote: string, currentPageText: string): "found" | "gone" {
  return quoteOnPage(quote, currentPageText) ? "found" : "gone";
}

export function repoCodeCitation(repo: Pick<ActiveRepoRef, "owner" | "name">, path: string, start: number, end: number): string {
  return `code:${repoSlug(repo)}:${path}:${start}-${end}`;
}

export interface ParsedRepoCitation { slug: string; path: string; start: number; end: number }

export function parseRepoCodeCitation(token: string): ParsedRepoCitation | null {
  const m = /^code:([^:\s]+)\/([^:\s]+):(.+):(\d+)-(\d+)$/.exec(token.trim());
  if (!m) return null;
  return { slug: `${m[1]}/${m[2]}`, path: m[3], start: Number(m[4]), end: Number(m[5]) };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface RepoHit { repoId: string; slug: string; path: string; line: number; text: string }

export function reposUsed(hits: readonly RepoHit[]): string[] {
  const seen: string[] = [];
  for (const h of hits) if (!seen.includes(h.slug)) seen.push(h.slug);
  return seen;
}

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
  /** Quoted page text this message is anchored to, when any. */
  quote?: string;
}

export interface PanelThread {
  pageKey: string;
  url: string;
  title: string;
  messages: PanelThreadMessage[];
}

/** Stored web-document content on a `web` review snapshot. */
export interface WebContent {
  url: string;
  title: string;
  pageKey: string;
  /** Hash of the captured context at thread creation (staleness). */
  captureHash: string;
  context: string;
  messages: PanelThreadMessage[];
}
