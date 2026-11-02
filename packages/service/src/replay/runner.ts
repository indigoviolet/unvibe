/**
 * Recorded-session `AgentRunner` (PRD §18): serves the
 * `fixtures/urllib3-5020/` recordings so UI and pipeline tests run without
 * live agents, and so a demo mode can replay a realistic session.
 *
 * Matching — an explicit `replay-kind: <kind>` / `replay-key: <key>`
 * marker wins, else kind/pattern matching like the prototype's `KB`/`ASK`
 * regexes — lives in `@unvibe/shared` (`replay-match.ts`), shared with
 * the static in-browser demo so the two can't drift (#334). Anything
 * unmatched gets a clearly-labelled placeholder, never silence.
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
import {
  chunkReplayText,
  replayPlaceholderText,
  replayUsageFor,
  resolveRecording,
  type ReplayManifestEntry,
} from "@unvibe/shared";
import { FakeAgentRunner } from "../agent/fake.js";
import type { Session } from "@unvibe/shared";

export type { ReplayManifestEntry as ManifestEntry };

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

/** Deterministic word-boundary chunking at ~`size` characters. */
export function chunkText(text: string, size: number): string[] {
  return chunkReplayText(text, size);
}

/** Deterministic fake usage derived from prompt + reply lengths. */
export function usageFor(promptChars: number, replyChars: number): {
  inputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  outputTokens: number;
} {
  return replayUsageFor(promptChars, replyChars);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ReplayAgentRunner extends FakeAgentRunner {
  private readonly entries: ReplayManifestEntry[] = [];
  private readonly texts = new Map<string, string>();
  private readonly chunkChars: number;
  readonly delayMs: number;

  constructor(opts: ReplayOptions) {
    super([]);
    this.chunkChars = opts.chunkChars ?? 64;
    this.delayMs = opts.delayMs ?? 0;
    const manifestPath = path.join(opts.fixturesDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      recordings: ReplayManifestEntry[];
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
    return resolveRecording(this.entries, (f) => this.texts.has(f), prompt);
  }

  placeholderText(resolved: ResolvedRecording, prompt: string): string {
    return replayPlaceholderText(resolved, prompt);
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
            signal.addEventListener("aborted", () => {
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
