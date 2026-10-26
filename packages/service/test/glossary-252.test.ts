/**
 * Issue #252: glossary — reader stores it, later turns receive it.
 *
 * Fake `AgentRunner` throughout; no real agents, no real GitHub.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, Hunk, ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { createApp } from "../src/server.js";

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 10 },
    { type: "done", stopReason: "end_turn" },
  ];
}

function hunkReply(summary: string): string {
  return `${summary}\n\n\`\`\`json\n{"hunk": {"summary": ${JSON.stringify(summary)}, "hiddenReason": null, "score": "routine"}}\n\`\`\`\n`;
}

function hunk(start: number, hash: string): Hunk {
  return {
    contentHash: hash,
    header: `@@ -${start},2 +${start},3 @@ fn`,
    newStart: start,
    newEnd: start + 2,
    oldStart: start,
    oldEnd: start + 1,
    added: 1,
    removed: 0,
    lines: [
      { kind: "ctx", oldLine: start, newLine: start, text: "x = 1" },
      { kind: "add", newLine: start + 1, text: "y = 2" },
      { kind: "ctx", oldLine: start + 1, newLine: start + 2, text: "z = 3" },
    ],
  };
}

function seedSnapshot(id: string): ReviewSnapshot {
  return {
    review: { id, repoId: "demo", branch: "main", versions: [], currentVersion: 1, createdAt: Date.now() },
    version: { n: 1, headSha: "abc1234def5678abc1234def5678abc1234def5", mergeBaseSha: "0000000", baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
    files: [{ fileKey: "a-py", path: "a.py", category: "source", hunks: [hunk(1, "h1"), hunk(10, "h2")] }],
    pages: [{ id: "root", kind: "root", title: "Guide", cards: [] }],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "ready" },
    pipeline: {
      stages: { reader: "pending", base: "pending", critic: "pending", "hunk-pass": "pending", "go-deeper": "pending" },
    },
  };
}

function seedDb(ctx: Awaited<ReturnType<typeof createApp>>["ctx"], id: string): void {
  ctx.db
    .prepare("INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
    .run("demo", "demo", "demo", "/tmp", Date.now());
  ctx.db
    .prepare("INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
    .run(id, "demo", "main", null, 1, Date.now(), JSON.stringify({}));
  ctx.db
    .prepare("INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(review_id, n) DO NOTHING")
    .run(id, 1, "abc1234def5678abc1234def5678abc1234def5", "0000000", "main", Date.now(), JSON.stringify({}));
}

async function waitFor(check: () => boolean, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const READER_WITH_GLOSSARY = `## The problem

Problem text.

## The central change

Central text.

\`\`\`json
{"cardIds": ["problem", "central"], "pendingCards": [{"id": "g-flow", "label": "Flow", "why": "follow it"}], "glossary": [
  {"name": "AlphaThing", "definition": "First helper.", "citation": "diff:a-py:1-2"},
  {"name": "BetaThing", "definition": "Second helper.", "citation": "diff:a-py:10-11"}
]}
\`\`\`
`;

describe("glossary #252", () => {
  it("reader stores the glossary and the hunk prompt carries it", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner([
      { match: "# Reader task", events: textEvents(READER_WITH_GLOSSARY) },
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Hunk pass", events: textEvents(hunkReply("Does the thing.")) },
    ]);
    const { app, ctx } = await createApp("tok", { agents: agents as unknown as never, autoPipeline: false });
    const id = `rv_gl${Math.random().toString(36).slice(2, 8)}`;
    try {
      seedDb(ctx, id);
      ctx.reviews.putSnapshot(id, seedSnapshot(id));
      await ctx.pipeline.resumeReview(id);
      await ctx.jobs.drain(60000);
      await waitFor(() => (ctx.reviews.getSnapshot(id)?.glossary?.length ?? 0) === 2);
      const snap = ctx.reviews.getSnapshot(id)!;
      expect(snap.glossary).toMatchObject([
        { name: "AlphaThing", definition: "First helper.", citation: "diff:a-py:1-2" },
        { name: "BetaThing", definition: "Second helper.", citation: "diff:a-py:10-11" },
      ]);
      // Run one on-demand summarize now that the glossary exists and
      // check its recorded prompt carries the context block. (The
      // ingest-time pass, if any, ran before the glossary existed.)
      const target = snap.files[0].hunks[0].contentHash;
      await ctx.reviews.mutate(id, (draft) => {
        draft.hunkStates = draft.hunkStates.filter((s) => s.contentHash !== target);
      });
      agents.prompts.length = 0;
      await ctx.pipeline.summarizeHunk(id, target);
      await ctx.jobs.drain(60000);
      const after = agents.prompts.filter((p) => p.text.includes("# Hunk pass"));
      expect(after.length).toBeGreaterThan(0);
      const last = after[after.length - 1].text;
      expect(last).toContain("## Glossary");
      expect(last).toContain("AlphaThing");
      expect(last).toContain("BetaThing");
    } finally {
      await app.close();
    }
  });

  it("Ask, Go deeper and concept prompts carry the glossary", { timeout: 120000 }, async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Hunk pass", events: textEvents(hunkReply("Does the thing.")) },
      { match: "# Ask", events: textEvents(`Answer about AlphaThing.\n\n\`\`\`json\n{}\n\`\`\`\n`) },
      { match: "# Go deeper", events: textEvents(`Filled go-deeper body.\n\n\`\`\`json\n{"title": "Flow"}\n\`\`\`\n`) },
      { match: "# Concept page", events: textEvents(`Concept body.\n\n\`\`\`json\n{"title": "Thing"}\n\`\`\`\n`) },
    ]);
    const { app, ctx } = await createApp("tok", { agents: agents as unknown as never, autoPipeline: false });
    const id = `rv_gl${Math.random().toString(36).slice(2, 8)}`;
    try {
      seedDb(ctx, id);
      const base = seedSnapshot(id);
      base.pages = [
        {
          id: "root",
          kind: "root",
          title: "Guide",
          cards: [
            {
              id: "problem",
              pageId: "root",
              title: "The problem",
              level: "standard",
              collapsed: false,
              revision: 1,
              blocks: [{ type: "paragraph", id: "b1", text: { standard: "Uses AlphaThing here." }, citations: [] }],
              undoStack: [],
            },
            {
              id: "g-flow",
              pageId: "root",
              title: "Flow",
              level: "standard",
              collapsed: false,
              revision: 1,
              blocks: [],
              undoStack: [],
              pending: { label: "Flow", why: "follow it" },
            },
          ],
        },
      ];
      base.glossary = [
        { name: "AlphaThing", definition: "First helper.", citation: "diff:a-py:1-2" },
        { name: "BetaThing", definition: "Second helper.", citation: "diff:a-py:10-11" },
      ];
      base.pipeline = {
        stages: { reader: "done", base: "done", critic: "done", "hunk-pass": "done", "go-deeper": "pending" },
      };
      ctx.reviews.putSnapshot(id, base);
      // Ask via HTTP (first turn renders the ask template with glossary).
      const res = (await app.inject({
        method: "POST",
        url: `/api/reviews/${id}/actions`,
        headers: { authorization: "Bearer tok" },
        payload: { kind: "ask", quote: "AlphaThing", anchor: { where: "block", blockId: "problem#b1" }, message: "What does it do?" },
      } as never)) as unknown as { statusCode: number; json: () => { jobId?: string } };
      expect(res.statusCode).toBe(200);
      if (res.json().jobId) await ctx.jobs.drain(60000);
      await waitFor(() => agents.prompts.some((p) => p.text.includes("# Ask") && p.text.includes("## Glossary")));
      // Go deeper fill.
      agents.prompts.length = 0;
      await ctx.pipeline.fillGoDeeper(id, "g-flow", undefined, () => {});
      await waitFor(() => agents.prompts.some((p) => p.text.includes("# Go deeper") && p.text.includes("## Glossary")));
      // Concept page.
      agents.prompts.length = 0;
      await ctx.pipeline.ensureConceptPage(id, "alpha-thing");
      await ctx.jobs.drain(60000);
      await waitFor(() => agents.prompts.some((p) => p.text.includes("# Concept page") && p.text.includes("## Glossary")));
      for (const p of agents.prompts.filter((x) => x.text.includes("## Glossary"))) {
        expect(p.text).toContain("AlphaThing");
      }
    } finally {
      await app.close();
    }
  });
});
