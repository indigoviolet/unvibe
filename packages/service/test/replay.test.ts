import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@unvibe/shared";
import { ReplayAgentRunner } from "../src/replay/runner.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "urllib3-5020",
);

function runner(): ReplayAgentRunner {
  return new ReplayAgentRunner({ fixturesDir, chunkChars: 64, delayMs: 0 });
}

async function collect(
  r: ReplayAgentRunner,
  prompt: string,
  signal?: AbortSignal,
): Promise<AgentEvent[]> {
  const session = await r.start({
    provider: "fixture",
    model: "fixture",
    cwd: "/",
    systemPrompt: "",
    mcpServers: [],
  });
  const events: AgentEvent[] = [];
  for await (const e of r.prompt(session, prompt, signal)) events.push(e);
  await r.close(session);
  return events;
}

describe("ReplayAgentRunner", () => {
  it("matches explain prompts by quoted text like the prototype KB regexes", async () => {
    const events = await collect(runner(), "Explain this: quote: what is obs-fold line folding?");
    const text = events
      .filter((e) => e.type === "text")
      .map((e) => (e.type === "text" ? e.delta : ""))
      .join("");
    expect(text).toContain("RFC 9112 now calls it");
  });

  it("matches ask prompts by question text like the prototype ASK regexes", async () => {
    const events = await collect(runner(), "Ask: does order of duplicate headers survive?");
    const text = events
      .filter((e) => e.type === "text")
      .map((e) => (e.type === "text" ? e.delta : ""))
      .join("");
    expect(text).toContain("Order and duplicates are preserved");
  });

  it("honours explicit replay-kind/replay-key markers", async () => {
    const r = runner();
    expect(r.resolve("replay-kind: hunk\nreplay-key: conn:0")).toMatchObject({
      file: "hunk-conn-0.md",
      placeholder: false,
    });
    expect(r.resolve("replay-kind: diagram\nreplay-key: fold")).toMatchObject({
      file: "diagram-fold.md",
      placeholder: false,
    });
  });

  it("serves a clearly-labelled placeholder when nothing matches", async () => {
    const events = await collect(runner(), "Tell me about quantum llamas.");
    const text = events
      .filter((e) => e.type === "text")
      .map((e) => (e.type === "text" ? e.delta : ""))
      .join("");
    expect(text).toMatch(/\[replay placeholder/);
  });

  it("streams the full recording then usage and done", async () => {
    const r = runner();
    const events = await collect(r, "replay-kind: hunk\nreplay-key: log:0");
    const kinds = events.map((e) => e.type);
    // #207: replay emits one tool call (arguments + result) before the
    // text, like a real runner, so Debug Output views work on the demo.
    expect(kinds.slice(0, 2)).toEqual(["tool", "tool"]);
    expect(events[0]).toMatchObject({ type: "tool", name: "Read", status: "start" });
    expect(events[1]).toMatchObject({ type: "tool", name: "Read", status: "end" });
    expect((events[1] as { result?: string }).result).toContain("hunk recording");
    expect(kinds[2]).toBe("text");
    expect(kinds.slice(-2)).toEqual(["usage", "done"]);
    // #207: usage carries the raw payload in the ACP shape, verbatim.
    const usage = events.find((e) => e.type === "usage") as { raw?: { _meta?: { quota?: { model_usage?: unknown[] } } } } | undefined;
    expect(usage?.raw?._meta?.quota?.model_usage).toHaveLength(1);
    const text = events
      .filter((e) => e.type === "text")
      .map((e) => (e.type === "text" ? e.delta : ""))
      .join("");
    expect(text).toBe(fs.readFileSync(path.join(fixturesDir, "recordings", "hunk-log-0.md"), "utf8"));
  });

  it("is deterministic: same input, same event sequence", async () => {
    const prompt = "Explain: the regex lookbehind and quadratic backtracking";
    const a = await collect(runner(), prompt);
    const b = await collect(runner(), prompt);
    expect(a).toEqual(b);
  });

  it("supports fork, load and close", async () => {
    const r = runner();
    const s = await r.start({ provider: "f", model: "m", cwd: "/", systemPrompt: "", mcpServers: [] });
    const forked = await r.fork(s);
    expect((await r.load(forked.id)).id).toBe(forked.id);
    await r.close(forked);
    await r.close(s);
  });

  it("cancels through the AbortSignal without done", async () => {
    const r = new ReplayAgentRunner({ fixturesDir, chunkChars: 8, delayMs: 20 });
    const session = await r.start({
      provider: "f",
      model: "m",
      cwd: "/",
      systemPrompt: "",
      mcpServers: [],
    });
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    const it = r.prompt(session, "replay-kind: reader", controller.signal)[Symbol.asyncIterator]();
    const first = await it.next();
    if (!first.done) events.push(first.value);
    controller.abort();
    for (;;) {
      const next = await it.next();
      if (next.done) break;
      events.push(next.value);
    }
    await r.close(session);
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });
});
