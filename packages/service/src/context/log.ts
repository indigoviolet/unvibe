/**
 * Append-only log and change lists (PRD §9.3).
 *
 * What enters the log:
 * - never: UI state — read, collapse, depth (the stepper position), open /
 *   close, Outbox marking. These change nothing the next turn needs.
 * - card-local only: examples, diagrams, depth rewrites. They are logged
 *   with a card scope and only shown to sessions anchored on that card.
 *   (Note: the *rewrite* is logged as a one-line label — the rewritten
 *   text itself travels in the base pack, and the depth *state* never
 *   enters the log.)
 * - one line, once a thread settles: a summary of the thread.
 * - in full: new cards and findings, answers that cited something
 *   outside the base, and contributions.
 * - a one-line deletion entry for a deleted item that had been shared.
 *
 * The base grows by appending batches (~2k tokens) so its cached prefix
 * stays valid. Each session records the last log entry it has seen; its
 * next turn gets a filtered change list: global entries plus local ones
 * for its card or hunk.
 */
import type { LogEntry } from "@unvibe/shared";
import { charTokenEstimator, DEFAULT_LOG_BATCH_TOKENS, type TokenEstimator } from "./tokens.js";

/** Log entry kinds the context builder understands. */
export type LogEntryKind =
  | "thread-summary"
  | "new-card"
  | "new-finding"
  | "out-of-base-answer"
  | "deletion"
  | "example"
  | "diagram"
  | "depth-rewrite"
  | "contribution"
  | "hunk-summary"
  | "update-note";

/**
 * UI-state kinds that never enter the log (PRD §9.3). The pipeline must
 * not create log entries for these; `shouldEnterLog` enforces it.
 */
export const NEVER_LOGGED_KINDS: ReadonlySet<string> = new Set([
  "read",
  "collapse",
  "depth",
  "open",
  "close",
  "mark-for-pr",
  "undo",
]);

/** Kinds that only make sense scoped to a card (PRD §9.3). */
export const CARD_LOCAL_KINDS: ReadonlySet<string> = new Set(["example", "diagram", "depth-rewrite"]);

/**
 * Decide whether an event enters the log. Returns false for UI state and
 * for card-local kinds logged without a card scope.
 */
export function shouldEnterLog(kind: string, scope: LogEntry["scope"]): boolean {
  if (NEVER_LOGGED_KINDS.has(kind)) return false;
  if (CARD_LOCAL_KINDS.has(kind) && scope.scope !== "card") return false;
  return true;
}

/**
 * Append one entry. Pure: returns a new array; `seq` is one past the
 * current maximum (1 when the log is empty).
 */
export function appendLogEntry(
  log: LogEntry[],
  kind: string,
  payload: unknown,
  scope: LogEntry["scope"],
): LogEntry[] {
  let max = 0;
  for (const e of log) if (e.seq > max) max = e.seq;
  return [...log, { seq: max + 1, kind, payload, scope }];
}

/** Deterministic JSON: object keys sorted recursively, stable for tests. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Kinds shared in full (PRD §9.3): their text keeps its line breaks. Every
 * other kind is folded onto one line. Nothing is ever cut short.
 */
export const FULL_TEXT_KINDS: ReadonlySet<string> = new Set([
  "new-card",
  "new-finding",
  "out-of-base-answer",
  "contribution",
]);

/**
 * Render one log entry as a Markdown list item. Continuation lines are
 * indented so multi-line text stays inside its item.
 */
export function formatLogEntry(entry: LogEntry): string {
  const scope = entry.scope.scope === "global" ? "global" : `card:${entry.scope.cardId}`;
  return `- [${entry.seq} ${entry.kind} ${scope}] ${indentContinuation(logEntryText(entry))}`;
}

/** The text of an entry: in full for `FULL_TEXT_KINDS`, one line otherwise. */
export function logEntryText(entry: LogEntry): string {
  const text = (entry.kind === "contribution" ? contributionText(entry.payload) : null) ?? payloadText(entry.payload);
  return FULL_TEXT_KINDS.has(entry.kind) ? text.trim() : text.replace(/\s+/g, " ").trim();
}

/** Text of a payload: prefer summary fields, else deterministic JSON. */
export function payloadText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const obj = payload as Record<string, unknown>;
    const pick = ["summary", "oneLine", "one_line", "text", "title", "why"];
    const found = pick.find((k) => typeof obj[k] === "string");
    if (found) return obj[found] as string;
  }
  return stableStringify(payload);
}

/** A contribution as its id plus one sub-item per kept item (`kind: text`). */
function contributionText(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const { contributionId, items } = payload as Record<string, unknown>;
  if (typeof contributionId !== "string" || !Array.isArray(items)) return null;
  const lines = [contributionId];
  for (const item of items) {
    const { kind, text } = (item ?? {}) as Record<string, unknown>;
    if (typeof kind !== "string" || typeof text !== "string") return null;
    lines.push(`- ${kind}: ${indentContinuation(text.trim())}`);
  }
  return lines.join("\n");
}

function indentContinuation(text: string): string {
  return text.replace(/\n(?!\n)/g, "\n  ");
}

/** Render a batch of entries as the L3 text appended to the base. */
export function formatLogBatch(entries: LogEntry[]): string {
  if (entries.length === 0) return "## Review log\n\n(no new entries)\n";
  const first = entries[0].seq;
  const last = entries[entries.length - 1].seq;
  return [`## Review log (seq ${first}–${last})`, "", ...entries.map(formatLogEntry), ""].join("\n");
}

/**
 * Group sequential log entries into batches of at most ~`batchTokens`
 * tokens (greedy; one oversized entry gets a batch of its own). The base
 * appends whole batches so its cached prefix stays valid.
 */
export function batchLogEntries(
  log: LogEntry[],
  opts: { estimator?: TokenEstimator; batchTokens?: number } = {},
): LogEntry[][] {
  const estimator = opts.estimator ?? charTokenEstimator;
  const batchTokens = opts.batchTokens ?? DEFAULT_LOG_BATCH_TOKENS;
  const batches: LogEntry[][] = [];
  let current: LogEntry[] = [];
  let currentTokens = 0;
  for (const entry of log) {
    const tokens = estimator.estimateTokens(formatLogEntry(entry));
    if (current.length > 0 && currentTokens + tokens > batchTokens) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(entry);
    currentTokens += tokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export interface ChangeListFilter {
  /** Last log seq the session has seen; only later entries are listed. */
  lastSeenSeq: number;
  /** Card the session is anchored on, if any. */
  cardId?: string;
  /** Hunk content hash the session is anchored on, if any. */
  hunkHash?: string;
}

/**
 * The filtered change list for a session's next turn (PRD §9.3): global
 * entries plus local ones for its card or hunk, after `lastSeenSeq`.
 * Hunk matching reads `payload.hunkHash` (hunk sessions have no card
 * scope in the shared `LogScope` type).
 */
export function filterChangeList(log: LogEntry[], filter: ChangeListFilter): LogEntry[] {
  return log.filter((entry) => {
    if (entry.seq <= filter.lastSeenSeq) return false;
    if (entry.scope.scope === "global") return true;
    if (filter.cardId !== undefined && entry.scope.cardId === filter.cardId) return true;
    if (
      filter.hunkHash !== undefined &&
      entry.payload !== null &&
      typeof entry.payload === "object" &&
      !Array.isArray(entry.payload) &&
      (entry.payload as Record<string, unknown>).hunkHash === filter.hunkHash
    ) {
      return true;
    }
    return false;
  });
}

/**
 * Render a change list for L4. Empty (session is up to date) renders as
 * `(no changes)` so the layer shape stays stable.
 */
export function formatChangeList(entries: LogEntry[]): string {
  if (entries.length === 0) return "(no changes)";
  return entries.map(formatLogEntry).join("\n");
}
