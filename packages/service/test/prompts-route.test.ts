import { describe, expect, it } from "vitest";
import { PROMPT_TEMPLATE_NAMES } from "@unvibe/shared";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expandAll, registerPrompts, type ExpandedPrompt } from "../src/routes/prompts.js";
import { loadTemplatesDirSync } from "../src/prompts/index.js";
import { fixtureSnapshot, HEAD_SHA } from "./fixtures.js";

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
      const explain = body.templates.find((t) => t.name === "explain");
      expect(explain?.variables).toContain("anchor.quote");
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
});
