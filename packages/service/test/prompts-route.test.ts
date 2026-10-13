import { describe, expect, it } from "vitest";
import { PROMPT_TEMPLATE_NAMES, type Contribution } from "@unvibe/shared";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expandAll, registerPrompts, toPromptSnapshot, type ExpandedPrompt } from "../src/routes/prompts.js";
import { formatContributionLines } from "../src/sharedctx/contributions.js";
import { buildBasePack } from "../src/context/index.js";
import { FakeCommandRunner } from "../src/exec/index.js";
import { loadTemplatesDirSync } from "../src/prompts/index.js";
import { fixtureSnapshot, HEAD_SHA } from "./fixtures.js";
import { setupReview } from "./m6-helpers.js";

const REPO_PROMPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "prompts");

async function buildApp(deps: Parameters<typeof registerPrompts>[1] = {}) {
  const app = Fastify();
  await registerPrompts(app, { promptsDir: REPO_PROMPTS, ...deps });
  return app;
}

describe("GET /api/prompts", () => {
  it("lists templates with variables marked", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/api/prompts" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { templates: { name: string; role: string; tier: string; variables: string[]; template: string }[] };
      expect(body.templates.map((t) => t.name).sort()).toEqual([...PROMPT_TEMPLATE_NAMES].sort());
      const reader = body.templates.find((t) => t.name === "reader");
      expect(reader?.variables).toEqual(["diff_inline", "repo_path", "source"]);
      expect(reader?.template).toContain("{{source}}");
      const ask = body.templates.find((t) => t.name === "ask");
      expect(ask?.variables).toContain("anchor.quote");
      const askTurn = body.templates.find((t) => t.name === "ask_turn");
      expect(askTurn?.variables).toEqual(["change_list", "message"]);
    } finally {
      await app.close();
    }
  });

  it("answers 501 for ?review= until a snapshot provider is wired", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/api/prompts?review=r1" });
      expect(res.statusCode).toBe(501);
    } finally {
      await app.close();
    }
  });

  it("answers 404 for an unknown review", async () => {
    const app = await buildApp({ snapshots: { getSnapshot: async () => null } });
    try {
      const res = await app.inject({ method: "GET", url: "/api/prompts?review=nope" });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("expands every template with layers marked and the cached part set apart", async () => {
    const app = await buildApp({ snapshots: { getSnapshot: async () => fixtureSnapshot() } });
    try {
      const res = await app.inject({ method: "GET", url: "/api/prompts?review=r-5020" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { templates: unknown[]; expanded: ExpandedPrompt[] };
      expect(body.expanded.map((e) => e.name).sort()).toEqual([...PROMPT_TEMPLATE_NAMES].sort());
      for (const e of body.expanded) {
        expect(e.expanded.length, `${e.name} text`).toBeGreaterThan(0);
        expect(e.layers.length, `${e.name} layers`).toBeGreaterThan(0);
        const layerTokens = e.layers.reduce((s, l) => s + l.tokens, 0);
        expect(layerTokens, `${e.name} token sum`).toBeGreaterThan(0);
        expect(e.cachedTokens, `${e.name} cached`).toBeLessThanOrEqual(layerTokens);
        expect(e.expanded, `${e.name} markers`).toContain("<!-- layer:");
        for (const span of e.spans) {
          expect(["L0", "L1", "L1b", "L2", "L3", "L4"]).toContain(span.layer);
        }
      }
      const byName = new Map(body.expanded.map((e) => [e.name, e]));
      // Critic forks the warm base: L0–L3 cached, L4 fresh.
      const critic = byName.get("critic")!;
      expect(critic.spans.map((s) => [s.layer, s.cached])).toEqual([
        ["L0", true],
        ["L1", true],
        ["L1b", true],
        ["L2", true],
        ["L3", true],
        ["L4", false],
      ]);
      expect(critic.cachedTokens).toBeGreaterThan(0);
      // Reader runs fresh: nothing cached.
      expect(byName.get("reader")!.cachedTokens).toBe(0);
      // Second-opinion blind sees the cited pin but not the guide or other findings.
      const blind = byName.get("second_opinion_blind")!;
      expect(blind.expanded).toContain("def _normalize_header_value");
      expect(blind.expanded).toContain("Folds that end in a bare LF are not unfolded");
      expect(blind.expanded).not.toContain("The linear-time claim has no test");
      expect(blind.expanded).not.toContain("Legacy servers folded long headers");
      expect(blind.expanded).not.toContain("Requests reads the original message");
      expect(blind.expanded).toContain(`code:src/urllib3/connection.py:91-110@${HEAD_SHA}`);
    } finally {
      await app.close();
    }
  });

  it("expandAll is pure: same snapshot renders the same bytes", () => {
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    const a = expandAll(lib, fixtureSnapshot());
    const b = expandAll(lib, fixtureSnapshot());
    expect(a.map((e) => e.expanded)).toEqual(b.map((e) => e.expanded));
  });

  it("consolidate preview uses the shared contribution formatter, not JSON (issue #80)", () => {
    const contributions: Contribution[] = [
      {
        id: "ct_1",
        sourceSession: "s1",
        items: [{ kind: "fact", text: "Reads the original message", citations: [] }],
        status: "pending",
      },
      {
        id: "ct_2",
        sourceSession: "s1",
        items: [{ kind: "correction", text: "Fix the fold", citations: [] }],
        replaces: "ct_0",
        status: "merged",
      },
    ];
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    const preview = expandAll(lib, { ...fixtureSnapshot(), contributions }).find((e) => e.name === "consolidate")!;
    // Identical to what the real consolidate call sends.
    expect(preview.expanded).toContain(formatContributionLines(contributions));
    expect(preview.expanded).toContain("- ct_1 [pending] replaces=-: [fact] Reads the original message");
    expect(preview.expanded).toContain("- ct_2 [merged] replaces=ct_0: [correction] Fix the fold");
    expect(preview.expanded).not.toContain('"items"');
  });
});

describe("toPromptSnapshot pinned code (#37)", () => {
  const PIN_TEXT = "PIN-PROBE-37 y = 2";
  const authed = { authorization: "Bearer tok" };

  it("passes the snapshot's pins through so the base pack and expanded prompt render L1b", async () => {
    const { app, ctx, reviewId } = await setupReview(new FakeCommandRunner());
    try {
      await ctx.reviews.mutate(reviewId, (draft) => {
        draft.pinnedCode = [
          { path: "a.py", start: 1, end: 2, sha: "a".repeat(40), text: PIN_TEXT, language: "python" },
        ];
      });
      const snap = ctx.reviews.getSnapshot(reviewId)!;
      expect(snap.pinnedCode).toHaveLength(1);

      // The adapter the pipeline, the prompts expansion and the debug page share.
      const promptSnap = toPromptSnapshot(snap);
      expect(promptSnap.pinnedCode).toHaveLength(1);
      expect(promptSnap.pinnedCode[0].text).toBe(PIN_TEXT);

      // Pipeline base pack: the same builder `ensureBase` uses.
      const pack = buildBasePack(promptSnap, "L0 instructions");
      expect(pack.l1b).toContain(PIN_TEXT);
      expect(pack.l1b).toContain("code:a.py:1-2@");
      expect(pack.l1b).not.toContain("(none)");
      expect(pack.user).toContain(PIN_TEXT);

      // Expanded-prompt view: the same expansion `GET /api/prompts?review=` uses.
      const lib = loadTemplatesDirSync(REPO_PROMPTS);
      const base = expandAll(lib, promptSnap).find((e) => e.name === "base_pack")!;
      expect(base.expanded).toContain(PIN_TEXT);

      // End to end through the wired snapshot provider.
      const res = await app.inject({ method: "GET", url: `/api/prompts?review=${reviewId}`, headers: authed });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { expanded: { name: string; expanded: string }[] };
      expect(body.expanded.find((e) => e.name === "base_pack")!.expanded).toContain(PIN_TEXT);

      // Size accounting: the pack token total covers L1b, so pins count
      // toward the base tokens the pipeline records.
      const bare = buildBasePack(toPromptSnapshot({ ...snap, pinnedCode: undefined }), "L0 instructions");
      expect(pack.tokens).toBeGreaterThan(bare.tokens);
    } finally {
      await app.close();
    }
  });

  it("no pins still renders (none) in L1b", async () => {
    const { app, ctx, reviewId } = await setupReview(new FakeCommandRunner());
    try {
      const snap = ctx.reviews.getSnapshot(reviewId)!;
      expect(snap.pinnedCode ?? []).toHaveLength(0);
      const promptSnap = toPromptSnapshot(snap);
      expect(promptSnap.pinnedCode).toEqual([]);
      const pack = buildBasePack(promptSnap, "L0 instructions");
      expect(pack.l1b).toContain("(none)");
    } finally {
      await app.close();
    }
  });
});
