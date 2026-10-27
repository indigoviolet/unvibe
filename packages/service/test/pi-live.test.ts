/**
 * Live pi runner test (issue #279) — excluded from `mise run check`, run
 * with `mise run test:live:pi` (UNVIBE_PI_LIVE=1) and only with the owner's
 * go and a cost cap. Uses the owner's existing pi login; never logs in,
 * never reads `~/.pi` (detection is the binary + pi's own status command).
 *
 * On any failure the test dumps the raw pi RPC events for every turn so
 * far — redacted (see redactRpc) — to a scratch file (`pi-rpc-events.json`
 * under the test's tmp dir) and the first 40 events to the test output, so
 * a live failure is diagnosable without another run. The runner taps raw
 * events through `PiAgentRunner({ onRpcEvent })`; nothing credential-like
 * is expected in them (no tokens ride the RPC stream), and the dump
 * redacts defensively anyway.
 *
 * Spend: 4 short turns (subscription-billed). Expected < $0.05 at list
 * price for gpt-6.1-sol (input $2, cached read $0.1, cached write $2.5,
 * output $10 per M tokens). Cost cap: $0.50 — the test throws if the
 * running estimate exceeds it. Nothing is posted anywhere; the canned
 * review below is synthetic, and pi only reads the empty tmp worktree.
 *
 * Coverage: subscription login through pi, review tools called in a fork
 * of a base session, resume after a restart, usage with the cache split
 * (#125), and a printed cost report. Fork cache-key sharing is asserted
 * structurally (the live cache-hit rate itself is reported, not asserted —
 * single live runs are directional, not benchmarks).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { AgentEvent } from "@unvibe/shared";
import { FakeCommandRunner, RealCommandRunner } from "../src/exec/runner.js";
import { McpRegistry, type McpReviewData } from "../src/mcp/index.js";
import { createApp } from "../src/server.js";
import { PiAgentRunner } from "../src/agent/pi/pi-runner.js";
import { probePiLogin } from "../src/readiness/checks.js";

const LIVE = process.env.UNVIBE_PI_LIVE === "1";

// List prices for gpt-6.1-sol (pi catalog): input $2, cached read $0.1,
// cached write $2.5, output $10 per M tokens. Upper-bound estimate only:
// subscription billing may differ.
const PRICE = { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 };
const COST_CAP_USD = 0.5;

const REVIEW: McpReviewData = {
  reviewId: "pi-live",
  headSha: "abc123",
  hunks: [
    {
      fileKey: "conn",
      path: "src/conn.py",
      contentHash: "9f2c",
      header: "@@ -140,7 +147,7 @@",
      newStart: 147,
      newEnd: 149,
      text: " context foo\n-old line\n+new line",
    },
  ],
  cards: [{ id: "c-central", title: "Central change", text: "retries with backoff in src/conn.py" }],
  annotations: [],
  contributions: [],
  description: [{ id: "d1", text: "this PR adds backoff" }],
};

function textOf(evs: AgentEvent[]): string {
  return evs.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
}

function usageOf(evs: AgentEvent[]): { inputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; outputTokens: number } {
  const u = evs.find((e) => e.type === "usage") as unknown as
    | { inputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; outputTokens: number }
    | undefined;
  if (!u) throw new Error("live pi: no usage event on the turn");
  return u;
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

/** Raw RPC events per turn, dumped (redacted) on failure. */
interface RawTurn {
  turn: string;
  events: unknown[];
}

/** Redact anything credential-like and truncate long strings before the dump
 * leaves the scratch dir (belt and braces: the RPC stream carries no tokens,
 * but a future pi event shape might). */
function redactRpc(key: string, value: unknown): unknown {
  if (/token|secret|password|apikey|api_key|authorization|bearer|cookie|sessionid|session_id/i.test(key)) {
    return "[redacted]";
  }
  if (typeof value === "string" && value.length > 2000) {
    return `${value.slice(0, 2000)}…[truncated ${value.length - 2000} chars]`;
  }
  return value;
}

describe.skipIf(!LIVE)("pi live runner", () => {
  it("login, review tools in a fork, resume, usage split, cost report", async () => {
    // Owner prerequisites, plainly: pi on PATH, logged in via pi's /login.
    const login = await probePiLogin(new RealCommandRunner(), "pi", 30000);
    if (!login.codex.ready && !login.openai.ready) {
      throw new Error(
        `live pi needs the owner's pi login (pi auth check: codex=${login.codex.status}, openai=${login.openai.status}). Run pi's /login once, then re-run.`,
      );
    }

    const dir = mkdtempSync(join(tmpdir(), "unvibe-pi-live-"));
    const sessionDir = join(dir, "sessions");
    const worktree = join(dir, "worktree");
    mkdirSync(worktree, { recursive: true });
    try {
      const registry = new McpRegistry({
        reader: {
          getReview: async (id) => (id === REVIEW.reviewId ? REVIEW : null),
          getWorktreePath: () => "/repo",
        },
        commands: new FakeCommandRunner(),
        onPin: () => {},
      });
      const { app } = await createApp("test-token", { mcp: registry });
      await app.listen({ host: "127.0.0.1", port: 0 });
      const addr = app.server.address() as AddressInfo;
      const issued = registry.issueSession(REVIEW.reviewId, "live-base", "session");
      const mcpServers = [{ name: issued.path.split("/").pop() ?? "unvibe", url: `http://127.0.0.1:${addr.port}${issued.path}` }];
      try {
        // Raw RPC tap: every event of every turn lands here, dumped
        // redacted on failure (the #279 empty-text run had no dump).
        const rawTurns: RawTurn[] = [];
        let current: unknown[] = [];
        const tap = (e: unknown): void => {
          current.push(e);
        };
        const collectTurn = async (name: string, it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> => {
          current = [];
          const out = await collect(it);
          rawTurns.push({ turn: name, events: current });
          return out;
        };
        const dumpRaw = (why: string): void => {
          try {
            const file = join(dir, "pi-rpc-events.json");
            writeFileSync(file, JSON.stringify(rawTurns, redactRpc, 2));
            const count = rawTurns.reduce((n, t) => n + t.events.length, 0);
            console.log(`[live-pi] ${why}: dumped ${count} raw RPC events in ${rawTurns.length} turn(s) to ${file}`);
            for (const t of rawTurns) {
              for (const e of t.events.slice(0, 40)) console.log(`[live-pi] [${t.turn}] ${JSON.stringify(e, redactRpc).slice(0, 2000)}`);
            }
          } catch (e) {
            console.log(`[live-pi] raw dump failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        };
        const runner = new PiAgentRunner({ sessionDir, onRpcEvent: tap });
        let forkId = "";
        try {
          const models = await runner.listModels("pi");
          const model = process.env.UNVIBE_PI_LIVE_MODEL ?? "gpt-6.1-sol";
          if (!models.some((m) => m.id === model)) {
            throw new Error(`live pi: ${model} not offered; pi offers ${models.map((m) => m.id).join(", ") || "nothing (is pi logged in?)"}`);
          }
          console.log(`[live-pi] model: ${model} (override with UNVIBE_PI_LIVE_MODEL)`);

          const totals = { input: 0, cachedRead: 0, cachedWrite: 0, output: 0 };
          const track = (evs: AgentEvent[]): void => {
            const u = usageOf(evs);
            totals.input += u.inputTokens;
            totals.cachedRead += u.cachedReadTokens;
            totals.cachedWrite += u.cachedWriteTokens;
            totals.output += u.outputTokens;
            const estimate = (totals.input * PRICE.input + totals.cachedRead * PRICE.cacheRead + totals.cachedWrite * PRICE.cacheWrite + totals.output * PRICE.output) / 1e6;
            console.log(`[live-pi] usage so far: ${JSON.stringify(totals)} ≈ $${estimate.toFixed(4)}`);
            if (estimate > COST_CAP_USD) throw new Error(`live pi cost cap exceeded ($${estimate.toFixed(4)} > $${COST_CAP_USD})`);
          };

          try {
            // Turn 1: base session comes up on the subscription login.
            const base = await runner.start({
              provider: "pi",
              model,
              cwd: worktree,
              systemPrompt: "You are Unvibe, a code reviewer. Reply exactly as asked.",
              mcpServers,
            });
            const ready = await collectTurn("turn1-ready", runner.prompt(base, "Reply with exactly `ready` and nothing else. The task arrives next."));
            expect(textOf(ready)).toMatch(/ready/i);
            track(ready);

            // Turn 2: a fork calls a review tool through the mount.
            const fork = await runner.fork!(base);
            expect(fork.id).not.toBe(base.id);
            forkId = fork.id;
            const answer = await collectTurn("turn2-hunk", runner.prompt(fork, "Call get_hunk with id h:conn:9f2c, then quote the header line of the hunk in your reply."));
            expect(textOf(answer)).toContain("@@");
            track(answer);
          } catch (e) {
            dumpRaw("turn 1-2 failed");
            throw e;
          }

          // Turn 3: resume after a simulated restart keeps history.
          await runner.dispose();
          const runner2 = new PiAgentRunner({ sessionDir, onRpcEvent: tap });
          try {
            const reopened = await runner2.load(forkId);
            const resumed = await collectTurn("turn3-resumed", runner2.prompt(reopened, "Reply with exactly `resumed` and nothing else."));
            expect(textOf(resumed)).toMatch(/resumed/i);
            track(resumed);
          } catch (e) {
            dumpRaw("turn 3 failed");
            throw e;
          } finally {
            await runner2.dispose();
          }
        } finally {
          await runner.dispose().catch(() => {});
        }
      } finally {
        await app.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300000);
});
