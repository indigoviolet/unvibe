/**
 * Replay matcher (issue #334): the single source of truth for matching a
 * prompt to a recorded session.
 *
 * The service's replay runner (`packages/service/src/replay/runner.ts`)
 * and the static in-browser demo (`packages/web/src/mock/`) share this
 * module, so the demo and the real replay can't drift: no canned answers
 * on either side. Anything without a recording gets a clearly-labelled
 * placeholder (service) or the honest install message (demo).
 *
 * Pure logic only: no Node/DOM APIs. Callers supply the manifest entries
 * and the recording texts (the service reads them from `fixtures/`, the
 * demo bakes them in at build time).
 */

export interface ReplayManifestEntry {
  kind: string;
  key?: string;
  /** Regex source matched against the prompt (explain/ask entries). */
  pattern?: string;
  file: string;
}

export interface ResolvedRecording {
  kind: string;
  key: string | null;
  file: string | null;
  /** True when this is the labelled placeholder, not a recording. */
  placeholder: boolean;
}

const KIND_HINTS: { re: RegExp; kind: string }[] = [
  { re: /replay-kind:\s*([\w-]+)/i, kind: "__explicit__" },
  // Base pack (SessionManager.getBase): the pipeline prefixes it with an
  // explicit "reply with exactly `ready`" instruction; answer "ready" (M3).
  { re: /reply with exactly\s+`?ready`?/i, kind: "base" },
  // Issue #351: the update pass is titled `# Update pass`. First, because
  // the prompt also names the critic and hunks below, which would match
  // their own hints before the update-pass recording existed.
  { re: /^# update pass/im, kind: "update-pass" },
  { re: /\breader\b|guided review|central change/i, kind: "reader" },
  { re: /\bcritic\b|agent finding/i, kind: "critic" },
  { re: /concept[-_ ]page|concept:\s*[\w-]+/i, kind: "concept-page" },
  { re: /\bhunk\b|summariz/i, kind: "hunk" },
  { re: /go[-_ ]deeper|placeholder card|\bgenerate\b/i, kind: "go-deeper" },
  { re: /\bdepth\b|simpler|\bdeeper\b/i, kind: "depth" },
  { re: /examples?/i, kind: "examples" },
  { re: /\bdiagram\b|\bd2\b/i, kind: "diagram" },
  // `ask` first: the merged first-turn prompt carries both words (#136).
  { re: /\bask\b|question|thread/i, kind: "ask" },
  { re: /\bexplain\b/i, kind: "explain" },
];

export function guessReplayKind(prompt: string): string | null {
  for (const hint of KIND_HINTS) {
    if (hint.kind === "__explicit__") continue;
    if (hint.re.test(prompt)) return hint.kind;
  }
  return null;
}

export function explicitReplayMarker(prompt: string): { kind: string; key: string | null } | null {
  const kind = prompt.match(/replay-kind:\s*([\w-]+)/i)?.[1]?.toLowerCase() ?? null;
  if (!kind) return null;
  const key = prompt.match(/replay-key:\s*([^\s]+)/i)?.[1]?.toLowerCase() ?? null;
  return { kind, key };
}

/**
 * Issue #365: follow-up turns carry no quote — only the message plus
 * the turn's own reply ID and its thread. When several ask/explain
 * entries match such a quoteless prompt, prefer a thread-scoped
 * (`thread-…`) recording: it was written for exactly this in-thread
 * context. A chip follow-up carries its own quote, so normal
 * first-match order applies there; prompts without thread/reply
 * context keep first-match order too, and the kind-only fallback (the
 * kind's first entry) is unchanged.
 */
const THREAD_CONTEXT = /ann:[\w-]+#r\d+|\bin thread \[\[ann:/i;
const QUOTE_PRESENT = /^> /m;

function preferThreadEntry<T extends { key?: string }>(hits: T[], prompt: string): T {
  if (hits.length > 1 && THREAD_CONTEXT.test(prompt) && !QUOTE_PRESENT.test(prompt)) {
    const threaded = hits.find((e) => (e.key ?? "").startsWith("thread-"));
    if (threaded) return threaded;
  }
  return hits[0] as T;
}

/** Pattern-matched ask/explain entries, in manifest order. */
function matchAskExplain(
  entries: ReplayManifestEntry[],
  hasText: (file: string) => boolean,
  kind: string,
  prompt: string,
): ResolvedRecording | null {
  const hits = entries.filter(
    (e) => e.kind === kind && e.pattern && new RegExp(e.pattern, "i").test(prompt) && hasText(e.file),
  );
  if (hits.length === 0) return null;
  const hit = preferThreadEntry(hits, prompt);
  return { kind, key: hit.key ?? null, file: hit.file, placeholder: false };
}

/**
 * Which recording (or placeholder) a prompt resolves to. Pure: entries
 * carry the manifest, `hasText` reports which files have loaded text.
 */
export function resolveRecording(
  entries: ReplayManifestEntry[],
  hasText: (file: string) => boolean,
  prompt: string,
): ResolvedRecording {
  const explicit = explicitReplayMarker(prompt);
  if (explicit) {
    // A kind-only marker (the pipeline's explain/ask jobs) keeps the
    // pattern matching below in play: the quoted selection decides
    // which recording answers, and only an unmatched prompt falls
    // back to the kind's first entry. A keyed marker is exact.
    if (explicit.key === null && (explicit.kind === "explain" || explicit.kind === "ask")) {
      const hit = matchAskExplain(entries, hasText, explicit.kind, prompt);
      if (hit) return hit;
    }
    const hit = entries.find(
      (e) => e.kind === explicit.kind && (explicit.key === null || e.key === explicit.key),
    );
    if (hit && hasText(hit.file)) {
      return { kind: hit.kind, key: hit.key ?? null, file: hit.file, placeholder: false };
    }
    return { kind: explicit.kind, key: explicit.key, file: null, placeholder: true };
  }
  const kind = guessReplayKind(prompt);
  if (kind === "explain" || kind === "ask") {
    // A follow-up carries its message but no quote; a first turn carries
    // quote and question. Either way the message (or quote) decides —
    // with thread-scoped recordings preferred in thread context.
    const hit = matchAskExplain(entries, hasText, kind, prompt);
    if (hit) return hit;
    return { kind, key: null, file: null, placeholder: true };
  }
  if (kind) {
    const key = extractReplayKey(kind, prompt);
    const hit =
      entries.find((e) => e.kind === kind && e.key === key && hasText(e.file)) ??
      (key === null ? entries.find((e) => e.kind === kind && hasText(e.file)) : undefined);
    if (hit) return { kind, key: hit.key ?? null, file: hit.file, placeholder: false };
    return { kind, key, file: null, placeholder: true };
  }
  return { kind: "unknown", key: null, file: null, placeholder: true };
}

export function replayPlaceholderText(resolved: ResolvedRecording, prompt: string): string {
  const hint = prompt.trim().split("\n")[0]?.slice(0, 80) ?? "";
  return (
    `[replay placeholder: no ${resolved.kind} recording matched this prompt. ` +
    `To see a canned reply, use an explain/ask prompt mentioning obs-fold, Set-Cookie, ` +
    `HTTP headers, regex, message rewrite, plotline, changelog, Requests, order, bare LF, ` +
    `duplicates, cost, tests, or unfolding scope — or a replay-kind:/replay-key: marker. First line was: "${hint}"]\n\n` +
    "```json\n{\"placeholder\": true}\n```\n"
  );
}

/** Deterministic word-boundary chunking at ~`size` characters. */
export function chunkReplayText(text: string, size: number): string[] {
  if (text.length === 0) return [];
  const chunks: string[] = [];
  let cur = "";
  for (const m of text.match(/\S+\s*|\s+/g) ?? []) {
    if (cur.length > 0 && cur.length + m.length > size && m.trim() !== "") {
      chunks.push(cur);
      cur = m;
    } else {
      cur += m;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Deterministic fake usage derived from prompt + reply lengths. */
export function replayUsageFor(promptChars: number, replyChars: number): {
  inputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  outputTokens: number;
} {
  const inputTokens = Math.max(1, Math.ceil(promptChars / 4));
  const outputTokens = Math.max(1, Math.ceil(replyChars / 4));
  return { inputTokens, cachedReadTokens: Math.floor(inputTokens / 2), cachedWriteTokens: 0, outputTokens };
}

export function extractReplayKey(kind: string, prompt: string): string | null {
  const lower = prompt.toLowerCase();
  switch (kind) {
    case "hunk": {
      const m = lower.match(/\b(conn|tconn|tsock|log):(\d+)\b/);
      return m ? `${m[1]}:${m[2]}` : null;
    }
    case "go-deeper": {
      for (const k of ["flow", "design", "regex", "check"]) {
        if (lower.includes(k)) return k;
      }
      return null;
    }
    case "depth": {
      const card = /central/.test(lower) ? "central" : /problem/.test(lower) ? "problem" : null;
      const level = /deep/.test(lower) ? "deep" : /simpl/.test(lower) ? "simple" : null;
      return card && level ? `${card}:${level}` : (card ?? level);
    }
    case "examples":
      return /central/.test(lower) ? "central" : /problem/.test(lower) ? "problem" : null;
    case "diagram":
      return /fold/.test(lower) ? "fold" : /path|flow|socket/.test(lower) ? "path" : null;
    case "concept-page": {
      const m = lower.match(/concept-page:\s*([\w-]+)/) ?? lower.match(/concept:([\w-]+)/);
      return m ? m[1] : null;
    }
    case "critic":
      // #215: one critic recording carries all findings; no per-finding key.
      return null;
    default:
      return null;
  }
}
