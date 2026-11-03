/**
 * Capture runner (live re-record only, issue #341).
 *
 * Wraps the real runner and saves every prompt/reply pair whose prompt
 * carries a `replay-kind:`/`replay-key:` marker — the same markers the
 * pipeline adds when it believes it is talking to the replay runner
 * (`withReplayMark`, gated on `isReplayRunner`). The marker is stripped
 * before delegating, so a real model never sees it; the saved reply is
 * the model's own raw text, which becomes the new fixture recording.
 *
 * Active only when constructed explicitly: `createAgentRunner` wraps the
 * real runner in this when `UNVIBE_CAPTURE_DIR` names a directory (set by
 * `scripts/live-rerecord-341.mjs`, never in normal runs or tests).
 * `isReplayRunner` duck-types on the `resolve` method below, which exists
 * only so the pipeline adds markers — it is never called.
 */
import fs from "node:fs";
import path from "node:path";
import type { AgentEvent, AgentRunner, McpServerConfig, Session } from "@unvibe/shared";
import { explicitReplayMarker } from "@unvibe/shared";

const MARKER_TAIL_RE = /\n\n<!-- replay-kind: [\w-]+(?: replay-key: [^\s]+)? -->\s*$/;

function safeKey(key: string | null): string {
  if (!key) return "nokey";
  const s = key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "nokey";
}

export class CaptureAgentRunner implements AgentRunner {
  private seq = 0;

  constructor(
    private readonly inner: AgentRunner,
    private readonly dir: string,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    // Resume: never overwrite an earlier capture in a shared dir.
    try {
      for (const f of fs.readdirSync(dir)) {
        const m = /^(\d+)-/.exec(f);
        if (m) this.seq = Math.max(this.seq, Number(m[1]));
      }
    } catch {
      // unreadable dir: sequence restarts (writes will fail loudly below).
    }
  }

  /** Marker-sniff presence only (see `isReplayRunner`); never called. */
  resolve(): { kind: string; key: string | null; file: string | null; placeholder: boolean } {
    throw new Error("CaptureAgentRunner.resolve is marker-sniff presence only; never called");
  }

  start(opts: {
    provider: string;
    model: string;
    cwd: string;
    systemPrompt: string;
    mcpServers: McpServerConfig[];
    readOnly?: boolean;
    effort?: string;
  }): Promise<Session> {
    return this.inner.start(opts);
  }

  fork(session: Session, opts?: { atMessage?: string }): Promise<Session> {
    if (typeof this.inner.fork !== "function") {
      throw new Error("inner runner does not support fork");
    }
    return this.inner.fork(session, opts);
  }

  load(sessionId: string): Promise<Session> {
    return this.inner.load(sessionId);
  }

  async *prompt(session: Session, text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const mark = explicitReplayMarker(text);
    const clean = mark ? text.replace(MARKER_TAIL_RE, "") : text;
    let full = "";
    for await (const ev of this.inner.prompt(session, clean, signal)) {
      if (ev.type === "text") full += ev.delta;
      yield ev;
    }
    if (!mark) return;
    const n = ++this.seq;
    const name = `${String(n).padStart(2, "0")}-${mark.kind}--${safeKey(mark.key)}.md`;
    fs.writeFileSync(path.join(this.dir, name), full);
    const indexLine = `${JSON.stringify({ seq: n, file: name, kind: mark.kind, key: mark.key, replyChars: full.length })}\n`;
    fs.appendFileSync(path.join(this.dir, "index.jsonl"), indexLine);
  }

  close(session: Session): Promise<void> {
    return this.inner.close(session);
  }

  takeSessionStartUsage?(sessionId: string):
    | { inputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; outputTokens: number }
    | undefined {
    return this.inner.takeSessionStartUsage?.(sessionId);
  }

  async listModels(provider: string): Promise<{ id: string; name?: string; description?: string }[]> {
    const inner = this.inner as AgentRunner & {
      listModels: (p: string) => Promise<{ id: string; name?: string; description?: string }[]>;
    };
    return inner.listModels(provider);
  }

  async listModelsWithDefault(
    provider: string,
  ): Promise<{ models: { id: string; name?: string; description?: string }[]; defaultId: string | null }> {
    const inner = this.inner as AgentRunner & {
      listModelsWithDefault?: (
        p: string,
      ) => Promise<{ models: { id: string; name?: string; description?: string }[]; defaultId: string | null }>;
      listModels: (p: string) => Promise<{ id: string; name?: string; description?: string }[]>;
    };
    if (typeof inner.listModelsWithDefault === "function") return inner.listModelsWithDefault(provider);
    return { models: await inner.listModels(provider), defaultId: null };
  }
}
