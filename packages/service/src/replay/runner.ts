/**
 * Recorded-session `AgentRunner` (PRD §18): serves the
 * `fixtures/urllib3-5020/` recordings so UI and pipeline tests run without
 * live agents, and so a demo mode can replay a realistic session.
 *
 * Matching: an explicit `replay-kind: <kind>` / `replay-key: <key>` marker
 * in the prompt wins (deterministic; used by tests and the pipeline).
 * Otherwise the kind is guessed from keywords and the key from the prompt:
 * `explain`/`ask` prompts are matched by the quoted text the same way the
 * prototype's `KB`/`ASK` regexes do (the manifest `pattern`s are those
 * regex sources); `hunk` by a `fileKey:index` mention; `go-deeper`,
 * `depth`, `examples`, `diagram` and `concept-page` by their key word.
 * Anything unmatched gets a clearly-labelled placeholder, never silence.
 *
 * Streaming is deterministic: the same prompt yields the same event
 * sequence. Text is chunked on word boundaries at `chunkChars` characters
 * with `delayMs` between chunks (0 in tests), then one `usage` and `done`.
 * `fork`/`load`/`close` come from `FakeAgentRunner`; an aborted
 * `AbortSignal` ends the stream with an `error` event (no `done`).
 */
import fs from "node:fs";
import path from "node:path";
import type { AgentEvent } from "@unvibe/shared";
import { FakeAgentRunner } from "../agent/fake.js";
import type { Session } from "@unvibe/shared";

export interface ManifestEntry {
  kind: string;
  key?: string;
  /** Regex source matched against the prompt (explain/ask entries). */
  pattern?: string;
  file: string;
}

export interface ReplayOptions {
  /** Fixture root holding `manifest.json` + `recordings/`. */
  fixturesDir: string;
  /** Target text-chunk size in characters (word-boundary split). */
  chunkChars?: number;
  /** Delay between chunks in ms (demo realism; 0 for tests). */
  delayMs?: number;
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
  { re: /\breader\b|guided review|central change/i, kind: "reader" },
  { re: /\bcritic\b|agent finding/i, kind: "critic" },
  { re: /concept[-_ ]stubs?|hidden concept/i, kind: "concept-stubs" },
  { re: /concept[-_ ]page|concept:\s*[\w-]+/i, kind: "concept-page" },
  { re: /\bhunk\b|summariz/i, kind: "hunk" },
  { re: /go[-_ ]deeper|placeholder card|\bgenerate\b/i, kind: "go-deeper" },
  { re: /\bdepth\b|simpler|\bdeeper\b/i, kind: "depth" },
  { re: /examples?/i, kind: "examples" },
  { re: /\bdiagram\b|\bd2\b/i, kind: "diagram" },
  // `ask` first: the merged first-turn prompt carries both words (#136).
  { re: /\bask\b|question|thread/i, kind: "ask" },
  { re: /\bexplain\b/i, kind: "explain" },
  { re: /second opinion/i, kind: "second-opinion" },
];

function guessKind(prompt: string): string | null {
  for (const hint of KIND_HINTS) {
    if (hint.kind === "__explicit__") continue;
    if (hint.re.test(prompt)) return hint.kind;
  }
  return null;
}

function explicitMarker(prompt: string): { kind: string; key: string | null } | null {
  const kind = prompt.match(/replay-kind:\s*([\w-]+)/i)?.[1]?.toLowerCase() ?? null;
  if (!kind) return null;
  const key = prompt.match(/replay-key:\s*([^\s]+)/i)?.[1]?.toLowerCase() ?? null;
  return { kind, key };
}

/** Deterministic word-boundary chunking at ~`size` characters. */
export function chunkText(text: string, size: number): string[] {
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

/** Deterministic fake usage derived from prompt + recording lengths. */
export function usageFor(promptChars: number, replyChars: number): {
  inputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  outputTokens: number;
} {
  const inputTokens = Math.max(1, Math.ceil(promptChars / 4));
  const outputTokens = Math.max(1, Math.ceil(replyChars / 4));
  return { inputTokens, cachedReadTokens: Math.floor(inputTokens / 2), cachedWriteTokens: 0, outputTokens };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ReplayAgentRunner extends FakeAgentRunner {
  private readonly entries: ManifestEntry[] = [];
  private readonly texts = new Map<string, string>();
  private readonly chunkChars: number;
  readonly delayMs: number;

  constructor(opts: ReplayOptions) {
    super([]);
    this.chunkChars = opts.chunkChars ?? 64;
    this.delayMs = opts.delayMs ?? 0;
    const manifestPath = path.join(opts.fixturesDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      recordings: ManifestEntry[];
    };
    for (const e of manifest.recordings) {
      this.entries.push(e);
      const full = path.join(opts.fixturesDir, "recordings", e.file);
      try {
        this.texts.set(e.file, fs.readFileSync(full, "utf8"));
      } catch {
        // Missing file: the entry stays listed but resolves to the
        // placeholder at prompt time, never a crash.
      }
    }
  }

  /** Which recording (or placeholder) a prompt resolves to. Pure. */
  resolve(prompt: string): ResolvedRecording {
    const explicit = explicitMarker(prompt);
    if (explicit) {
      // A kind-only marker (the pipeline's explain/ask jobs) keeps the
      // pattern matching below in play: the quoted selection decides
      // which recording answers, and only an unmatched prompt falls
      // back to the kind's first entry. A keyed marker is exact.
      if (explicit.key === null && (explicit.kind === "explain" || explicit.kind === "ask")) {
        for (const e of this.entries) {
          if (e.kind !== explicit.kind || !e.pattern) continue;
          if (new RegExp(e.pattern, "i").test(prompt) && this.texts.has(e.file)) {
            return { kind: explicit.kind, key: e.key ?? null, file: e.file, placeholder: false };
          }
        }
      }
      const hit = this.entries.find(
        (e) =>
          e.kind === explicit.kind && (explicit.key === null || e.key === explicit.key),
      );
      if (hit && this.texts.has(hit.file)) {
        return { kind: hit.kind, key: hit.key ?? null, file: hit.file, placeholder: false };
      }
      return { kind: explicit.kind, key: explicit.key, file: null, placeholder: true };
    }
    const kind = guessKind(prompt);
    if (kind === "explain" || kind === "ask") {
      for (const e of this.entries) {
        if (e.kind !== kind || !e.pattern) continue;
        if (new RegExp(e.pattern, "i").test(prompt) && this.texts.has(e.file)) {
          return { kind, key: e.key ?? null, file: e.file, placeholder: false };
        }
      }
      return { kind, key: null, file: null, placeholder: true };
    }
    if (kind) {
      const key = extractKey(kind, prompt);
      const hit =
        this.entries.find((e) => e.kind === kind && e.key === key && this.texts.has(e.file)) ??
        (key === null ? this.entries.find((e) => e.kind === kind && this.texts.has(e.file)) : undefined);
      if (hit) return { kind, key: hit.key ?? null, file: hit.file, placeholder: false };
      return { kind, key, file: null, placeholder: true };
    }
    return { kind: "unknown", key: null, file: null, placeholder: true };
  }

  placeholderText(resolved: ResolvedRecording, prompt: string): string {
    const hint = prompt.trim().split("\n")[0]?.slice(0, 80) ?? "";
    return (
      `[replay placeholder: no ${resolved.kind} recording matched this prompt. ` +
      `To see a canned reply, use an explain/ask prompt mentioning obs-fold, HTTPHeaderDict, ` +
      `CRLF, regex, Set-Cookie, OWS, RFC 9112, Requests, bare LF, order, identity, cost, ` +
      `tests, or forwarding — or a replay-kind:/replay-key: marker. First line was: "${hint}"]\n\n` +
      "```json\n{\"placeholder\": true}\n```\n"
    );
  }

  private replayToolSeq = 0;

  override async *prompt(
    session: Session,
    text: string,
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    this.prompts.push({ sessionId: session.id, text });
    const resolved = this.resolve(text);
    // Base pack: answer "ready" (SessionManager.getBase waits for it).
    const reply =
      resolved.kind === "base" ? "ready" : resolved.file ? this.texts.get(resolved.file)! : this.placeholderText(resolved, text);
    // Issue #207: replay emits the same event shapes as a real runner —
    // one tool call with arguments and a result, then the text, then
    // usage with its raw payload — so the Debug page's Output view (and
    // the journeys through it) work against the demo recordings.
    if (resolved.kind !== "base") {
      const toolId = `replay-tool-${++this.replayToolSeq}`;
      yield {
        type: "tool",
        name: "Read",
        status: "start",
        id: toolId,
        detail: JSON.stringify({ recording: resolved.file ?? resolved.kind }),
      };
      yield {
        type: "tool",
        name: "Read",
        status: "end",
        id: toolId,
        result: `Returned the ${resolved.kind} recording (${reply.length} chars).`,
      };
    }
    const chunks = chunkText(reply, this.chunkChars);
    for (const chunk of chunks) {
      if (signal?.aborted) {
        yield { type: "error", message: "aborted", retryable: true };
        return;
      }
      if (this.delayMs > 0) {
        if (signal) {
          const aborted = await new Promise<boolean>((done) => {
            const timer = setTimeout(() => done(false), this.delayMs);
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              done(true);
            }, { once: true });
          });
          if (aborted || signal.aborted) {
            yield { type: "error", message: "aborted", retryable: true };
            return;
          }
        } else {
          await sleep(this.delayMs);
        }
      }
      yield { type: "text", delta: chunk };
    }
    if (signal?.aborted) {
      yield { type: "error", message: "aborted", retryable: true };
      return;
    }
    const usage = usageFor(text.length, reply.length);
    yield {
      type: "usage",
      ...usage,
      // Same raw shape the ACP runner reports (`usage` + `_meta.quota`),
      // derived deterministically from the same counts.
      raw: {
        usage: {
          inputTokens: usage.inputTokens,
          cachedReadTokens: usage.cachedReadTokens,
          cachedWriteTokens: usage.cachedWriteTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.inputTokens + usage.cachedReadTokens + usage.cachedWriteTokens + usage.outputTokens,
        },
        _meta: {
          quota: {
            token_count: {
              inputTokens: usage.inputTokens,
              cachedInputTokens: usage.cachedReadTokens,
              cachedWriteTokens: usage.cachedWriteTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.inputTokens + usage.cachedReadTokens + usage.cachedWriteTokens + usage.outputTokens,
            },
            model_usage: [
              {
                model: "replay",
                token_count: {
                  inputTokens: usage.inputTokens,
                  cachedInputTokens: usage.cachedReadTokens,
                  cachedWriteTokens: usage.cachedWriteTokens,
                  outputTokens: usage.outputTokens,
                  totalTokens: usage.inputTokens + usage.cachedReadTokens + usage.cachedWriteTokens + usage.outputTokens,
                },
              },
            ],
          },
        },
      },
    };
    yield { type: "done", stopReason: "end_turn" };
  }
}

function extractKey(kind: string, prompt: string): string | null {
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
    case "second-opinion": {
      // Keys are `<card-or-finding-id>:<mode>` (e.g. `f-lf:blind`,
      // `central:check`). Match the most specific one present.
      const m = lower.match(/\b(f-lf|f-perf|central|problem|g-flow|g-design|g-regex|g-check|flf-ev|flf-as|fpf-ev|fpf-as)[-:](blind|check)\b/);
      if (m) return `${m[1]}:${m[2]}`;
      if (lower.includes("blind")) return "blind";
      if (lower.includes("check this claim") || lower.includes("check")) return "check";
      return null;
    }
    default:
      return null;
  }
}
