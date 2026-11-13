/**
 * Guide prompt forks (issue #393).
 *
 * A persona id owns `prompts/personas/<id>/`; any template there
 * replaces the shared template whole-file for every task that persona's
 * guide runs. A folder with `reader.md` is guide-capable; the review
 * records its Guide persona and every main-agent task resolves
 * templates, model and lens through it; card personas layer their lens
 * on top of the fork's instructions; Re-do with re-runs the guide under
 * a chosen persona.
 *
 * Fake runner only; no live spend.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GUIDE_PERSONA_ID,
  type Persona,
  type ReviewSnapshot,
} from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import type { AgentEvent } from "@unvibe/shared";
import { createApp } from "../src/server.js";
import {
  GUIDE_FORK_STYLE_TEMPLATES,
  copyPersonaFork,
  forkDrift,
  forkedTemplateNames,
  isGuideCapable,
  loadPersonaLibrarySync,
  readForkManifest,
  withGuideStyleForReview,
} from "../src/prompts/personas.js";
import { loadTemplatesDirSync } from "../src/prompts/index.js";
import { renderUpdatePrompt } from "../src/versions/update.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_PROMPTS = path.resolve(TEST_DIR, "..", "..", "..", "prompts");
const FORK_SCRIPT = path.resolve(TEST_DIR, "..", "..", "..", "scripts", "persona-fork.mjs");

function tpl(body: string, variables: string[] = []): string {
  return `---\nrole: user\ntier: main\nvariables: [${variables.join(", ")}]\n---\n\n${body}`;
}

/** Minimal valid prompts dir (shared templates only). */
function makeBasePrompts(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-fork-base-"));
  writeFileSync(path.join(dir, "instructions.md"), `---\nrole: system\ntier: main\nvariables: [access_policy]\n---\n\nBase instructions. {{access_policy}}\n`);
  writeFileSync(path.join(dir, "reader.md"), tpl("# Reader task\n\nSource: {{source}}\n", ["source"]));
  writeFileSync(path.join(dir, "depth.md"), tpl("# Depth\n\nCard: {{card}}\n", ["card"]));
  writeFileSync(path.join(dir, "update_pass.md"), tpl("# Update\n\nHunks: {{changed_hunks}}\n", ["changed_hunks"]));
  return dir;
}

/** Full-size fixture: real prompts plus a `tutor` fork with sentinels. */
function makePipelinePrompts(): { dir: string; forkFiles: string[] } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-fork-pipe-"));
  cpSync(REPO_PROMPTS, dir, { recursive: true });
  const forked = ["reader", "slower", "instructions", "hunk_pass", "update_pass"];
  const { copied } = copyPersonaFork(dir, "tutor", forked);
  expect(copied.sort()).toEqual([...forked].sort());
  const sentinel: Record<string, string> = {
    reader: "FORK-READER-SENTINEL",
    slower: "FORK-SLOWER-SENTINEL",
    instructions: "FORK-INSTRUCTIONS-SENTINEL",
    hunk_pass: "FORK-HUNK-SENTINEL",
    update_pass: "FORK-UPDATE-SENTINEL",
  };
  for (const name of forked) {
    const file = path.join(dir, "personas", "tutor", `${name}.md`);
    writeFileSync(file, `${readFileSync(file, "utf8")}\n\n${sentinel[name]}: written by the Tutor fork.\n`);
  }
  return { dir, forkFiles: forked };
}

async function waitFor(check: () => boolean, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("fork library (overlay, capability, manifest, drift)", () => {
  it("overlays same-named templates whole, falls back otherwise, ignores non-base files", () => {
    const dir = makeBasePrompts();
    try {
      const forkDir = path.join(dir, "personas", "tutor");
      mkdirSync(forkDir, { recursive: true });
      writeFileSync(path.join(forkDir, "reader.md"), tpl("# Tutor reader\n\nSource: {{source}}\n", ["source"]));
      writeFileSync(path.join(forkDir, "notes.md"), "not a template\n");
      const lib = loadPersonaLibrarySync(dir, "tutor");
      expect(lib.get("reader")?.body).toContain("# Tutor reader");
      // Fallback: depth is untouched.
      expect(lib.get("depth")?.body).toContain("# Depth");
      // Non-base files never become templates.
      expect(lib.has("notes")).toBe(false);
      // The built-in Guide (and a missing folder) keeps shared bytes.
      expect(loadPersonaLibrarySync(dir, GUIDE_PERSONA_ID).get("reader")?.body).toContain("# Reader task");
      expect(loadPersonaLibrarySync(dir, "nobody").get("reader")?.body).toContain("# Reader task");
      expect(loadPersonaLibrarySync(dir).get("reader")?.body).toContain("# Reader task");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects guide capability by reader.md only", () => {
    const dir = makeBasePrompts();
    try {
      expect(isGuideCapable(dir, "tutor")).toBe(false);
      mkdirSync(path.join(dir, "personas", "tutor"), { recursive: true });
      writeFileSync(path.join(dir, "personas", "tutor", "lens.md"), "a lens, not a guide\n");
      expect(isGuideCapable(dir, "tutor")).toBe(false);
      writeFileSync(path.join(dir, "personas", "tutor", "reader.md"), tpl("guide\n"));
      expect(isGuideCapable(dir, "tutor")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("copies missing files, keeps merged ones, and records base hashes", () => {
    const dir = makeBasePrompts();
    try {
      const first = copyPersonaFork(dir, "tutor", ["reader", "depth"]);
      expect(first).toEqual({ copied: ["reader", "depth"], skipped: [] });
      // A manual merge survives a re-run; the manifest follows the base.
      const forkReader = path.join(dir, "personas", "tutor", "reader.md");
      writeFileSync(forkReader, `${readFileSync(forkReader, "utf8")}\nMerged teaching note.\n`);
      const second = copyPersonaFork(dir, "tutor", ["reader", "depth"]);
      expect(second).toEqual({ copied: [], skipped: ["reader", "depth"] });
      expect(readFileSync(forkReader, "utf8")).toContain("Merged teaching note.");
      const manifest = readForkManifest(dir, "tutor");
      expect(manifest?.personaId).toBe("tutor");
      expect(Object.keys(manifest?.files ?? {}).sort()).toEqual(["depth", "reader"]);
      expect(forkedTemplateNames(loadTemplatesDirSync(dir), dir, "tutor")).toEqual(["depth", "reader"]);
      expect(() => copyPersonaFork(dir, "tutor", ["nope"])).toThrow(/not a base template/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports drift when a base file changes since the manifest", () => {
    const dir = makeBasePrompts();
    try {
      copyPersonaFork(dir, "tutor", ["reader", "depth"]);
      expect(forkDrift(dir, "tutor")).toEqual([]);
      writeFileSync(path.join(dir, "reader.md"), `${readFileSync(path.join(dir, "reader.md"), "utf8")}\nNew base rule.\n`);
      expect(forkDrift(dir, "tutor")).toEqual(["reader.md"]);
      // Re-running after the manual merge clears the warning.
      copyPersonaFork(dir, "tutor", ["reader"]);
      expect(forkDrift(dir, "tutor")).toEqual([]);
      // A fork file the helper never recorded counts as drifted too.
      writeFileSync(path.join(dir, "personas", "tutor", "update_pass.md"), tpl("forked\n"));
      expect(forkDrift(dir, "tutor")).toEqual(["update_pass.md"]);
      // No fork at all means no warning.
      expect(forkDrift(dir, "nobody")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a fork that drops a base variable, naming the persona and file", () => {
    const dir = makeBasePrompts();
    try {
      const forkDir = path.join(dir, "personas", "tutor");
      mkdirSync(forkDir, { recursive: true });
      // Parses on its own, but drops the base's {{source}} (slower.md's
      // {{terms}}/{{guide}} are the real case this guards).
      writeFileSync(path.join(forkDir, "reader.md"), tpl("# Tutor reader\n\nNo source here.\n", []));
      expect(() => loadPersonaLibrarySync(dir, "tutor")).toThrow(
        /persona "tutor" fork of reader\.md.*missing base variables: source/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("re-running for one file leaves the other files' drift alone", () => {
    const dir = makeBasePrompts();
    try {
      copyPersonaFork(dir, "tutor", ["reader", "depth"]);
      expect(forkDrift(dir, "tutor")).toEqual([]);
      // Both base files move: both drift.
      for (const name of ["reader", "depth"]) {
        const file = path.join(dir, `${name}.md`);
        writeFileSync(file, `${readFileSync(file, "utf8")}\nNew base rule.\n`);
      }
      expect(forkDrift(dir, "tutor")).toEqual(["depth.md", "reader.md"]);
      // Re-run naming only reader (as a file name, like the hint prints):
      // reader clears, depth still drifts.
      copyPersonaFork(dir, "tutor", ["reader.md"]);
      expect(forkDrift(dir, "tutor")).toEqual(["depth.md"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("places the fork Guide lens on the listed tasks only", () => {
    const prompt = "# Depth rewrite\n\nRewrite the card.";
    const lens = "Tutor it.";
    expect(withGuideStyleForReview("reader", prompt, lens, false).startsWith("# Writing style")).toBe(true);
    expect(withGuideStyleForReview("critic", prompt, lens, false)).toBe(prompt);
    expect(withGuideStyleForReview("hunk_pass", prompt, lens, false)).toBe(prompt);
    for (const template of GUIDE_FORK_STYLE_TEMPLATES) {
      expect(withGuideStyleForReview(template, prompt, lens, true).startsWith("# Writing style")).toBe(true);
    }
    expect(withGuideStyleForReview("persona_card", prompt, lens, true)).toBe(prompt);
    expect(withGuideStyleForReview("consolidate", prompt, lens, true)).toBe(prompt);
    expect(withGuideStyleForReview("reader", prompt, "", true)).toBe(prompt);
    expect(withGuideStyleForReview("reader", prompt, "  ", true)).toBe(prompt);
  });

  it("renders the update pass from the fork when present", () => {
    const dir = makeBasePrompts();
    try {
      const vars = { changed_hunks: "h", stale_cards: "s", findings: "f" };
      expect(renderUpdatePrompt(dir, vars, "tutor")).toContain("Hunks: h");
      copyPersonaFork(dir, "tutor", ["update_pass"]);
      const forkFile = path.join(dir, "personas", "tutor", "update_pass.md");
      writeFileSync(forkFile, `${readFileSync(forkFile, "utf8")}\nFORK-UPDATE-SENTINEL\n`);
      const rendered = renderUpdatePrompt(dir, vars, "tutor");
      expect(rendered).toContain("FORK-UPDATE-SENTINEL");
      expect(rendered).toContain("Hunks: h");
      // The built-in Guide keeps the shared template.
      expect(renderUpdatePrompt(dir, vars, GUIDE_PERSONA_ID)).not.toContain("FORK-UPDATE-SENTINEL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 10 },
    { type: "done", stopReason: "end_turn" },
  ];
}

const TUTOR_LENS = "TUTOR-LENS-SENTINEL: explain like a patient tutor, one mechanism at a time.";

const TUTOR: Persona = {
  id: "tutor",
  name: "Tutor",
  followMain: false,
  provider: "codex",
  model: "gpt-6.1-sol",
  lens: TUTOR_LENS,
  cardInstruction: "",
  enabled: true,
  color: "#0E7C86",
};

const HUNK_SUMMARY = `{"hunk": {"summary": "Adds the new flag.", "hiddenReason": null}}`;

function pipelineAgents(): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: "reply with exactly", events: textEvents("ready") },
    {
      match: "FORK-READER-SENTINEL",
      events: textEvents(
        `## The problem\n\nThe fork teaches the problem first.\n\n## The central change\n\nThe fork teaches the change.\n\n\`\`\`json\n{}\n\`\`\`\n`,
      ),
    },
    {
      match: "FORK-SLOWER-SENTINEL",
      events: textEvents(`## Central\n\nSlower, taught slowly.\n\n\`\`\`json\n{}\n\`\`\`\n`),
    },
    {
      match: "FORK-HUNK-SENTINEL",
      events: textEvents(`${HUNK_SUMMARY}\n`),
    },
    {
      // Clarity carries its own card instruction (not the default), so
      // match the lens the turn is prefixed with.
      match: "You are Clarity",
      events: textEvents(`## Central\n\nRewritten for clarity.\n\n\`\`\`json\n{}\n\`\`\`\n`),
    },
  ]);
}

/** One review row + snapshot stamped with a Guide persona (branch source, redoable). */
function seedBranchReview(
  ctx: Awaited<ReturnType<typeof createApp>>["ctx"],
  reviewId: string,
  guidePersonaId: string,
  branch = "feature",
): void {
  ctx.db
    .prepare(
      "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    )
    .run("rp", "o", "n", mkdtempSync(path.join(os.tmpdir(), "unvibe-393-repo-")), Date.now());
  ctx.repos.upsert({ id: "rp", owner: "o", name: "n", localPath: "/tmp", lastOpened: Date.now() });
  ctx.db
    .prepare(
      "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    )
    .run(reviewId, "rp", branch, null, 1, Date.now(), JSON.stringify({}));
  ctx.db
    .prepare(
      "INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(review_id, n) DO NOTHING",
    )
    .run(reviewId, 1, "a".repeat(40), "b".repeat(40), "main", Date.now(), JSON.stringify({}));
  const snap = {
    review: { id: reviewId, repoId: "rp", branch, versions: [], currentVersion: 1, guidePersonaId, createdAt: Date.now() },
    version: { n: 1, headSha: "a".repeat(40), mergeBaseSha: "b".repeat(40), baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
    files: [],
    pages: [{ id: "root", kind: "root", title: "Guide", cards: [] }],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false, hideLevel: "uninteresting" },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "ready" },
  };
  ctx.reviews.putSnapshot(reviewId, snap as unknown as ReviewSnapshot);
}

async function pipelineApp(agents: FakeAgentRunner, promptsDir: string): Promise<ReturnType<typeof createApp>> {
  const created = await createApp("tok", { agents, promptsDir, autoPipeline: false });
  const seed = created.ctx.settings.get().personas ?? [];
  const res = await created.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { authorization: "Bearer tok" },
    payload: { personas: [...seed, TUTOR] },
  } as never);
  expect(res.statusCode).toBe(200);
  return created;
}

describe("fork guide through the pipeline (fake runner)", () => {
  it("runs the reader on the persona model with fork templates and lens", async () => {
    const agents = pipelineAgents();
    const { dir } = makePipelinePrompts();
    const created = await pipelineApp(agents, dir);
    const ctx = created.ctx;
    try {
      const reviewId = "rv_393reader";
      seedBranchReview(ctx, reviewId, "tutor");
      // One small file so the ladder has something to inline.
      await ctx.reviews.mutate(reviewId, (draft) => {
        draft.files = [
          {
            fileKey: "a-py",
            path: "a.py",
            category: "source",
            hunks: [
              {
                contentHash: "h393",
                header: "@@ -1,2 +1,2 @@",
                newStart: 1,
                newEnd: 2,
                oldStart: 1,
                oldEnd: 2,
                added: 1,
                removed: 1,
                lines: [
                  { kind: "ctx", oldLine: 1, newLine: 1, text: "x = 1" },
                  { kind: "del", oldLine: 2, text: "y = 1" },
                  { kind: "add", newLine: 2, text: "y = 2" },
                ],
              },
            ],
          },
        ];
      });
      await ctx.pipeline.startReview(reviewId);
      await waitFor(() => ctx.jobs.listByReview(reviewId).some((j) => j.kind === "reader" && j.state === "done"));
      const reader = ctx.jobs.listByReview(reviewId).find((j) => j.kind === "reader")!;
      // Model resolves through the persona, not the small role or main default.
      expect(reader.provider).toBe("codex");
      expect(reader.model).toBe("gpt-6.1-sol");
      // The turn is the fork's reader with the persona lens as the style.
      const turns = agents.prompts.filter((p) => p.text.includes("FORK-READER-SENTINEL"));
      expect(turns.length).toBeGreaterThan(0);
      for (const turn of turns) {
        expect(turn.text.startsWith(`# Writing style\n\n${TUTOR_LENS}\n\n`)).toBe(true);
      }
      // The base session carries the fork's instructions (L0).
      expect(agents.starts.some((s) => s.systemPrompt.includes("FORK-INSTRUCTIONS-SENTINEL"))).toBe(true);
      // The guide landed.
      await waitFor(
        () =>
          (ctx.reviews.getSnapshot(reviewId)?.pages.find((p) => p.id === "root")?.cards.length ?? 0) >= 2,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  it("runs slower on the fork template with the fork lens and model", async () => {
    const agents = pipelineAgents();
    const { dir } = makePipelinePrompts();
    const created = await pipelineApp(agents, dir);
    const ctx = created.ctx;
    try {
      const reviewId = "rv_393depth";
      seedBranchReview(ctx, reviewId, "tutor");
      const result = await ctx.pipeline.runInFork({
        reviewId,
        kind: "slower",
        template: "slower",
        variables: { card: "## Central\n\nFold body.", terms: "", guide: "" },
        priority: 100,
      });
      expect(result.text).toContain("Slower, taught slowly.");
      const turns = agents.prompts.filter((p) => p.text.includes("FORK-SLOWER-SENTINEL"));
      expect(turns.length).toBeGreaterThan(0);
      for (const turn of turns) {
        expect(turn.text.startsWith(`# Writing style\n\n${TUTOR_LENS}\n\n`)).toBe(true);
        expect(turn.text).toContain("# Help me understand");
      }
      expect(agents.startCalls.some((s) => s.provider === "codex" && s.model === "gpt-6.1-sol")).toBe(true);
      // The built-in Guide's empty lens leaves the same turn byte-identical to shared.
      const sharedTurns = agents.prompts.filter((p) => p.text.includes("# Help me understand"));
      expect(sharedTurns.every((p) => p.text.includes("FORK-SLOWER-SENTINEL"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  it("runs a card persona on the fork instructions under its own lens", async () => {
    const agents = pipelineAgents();
    const { dir } = makePipelinePrompts();
    const { app, ctx } = await pipelineApp(agents, dir);
    try {
      const reviewId = "rv_393clarity";
      seedBranchReview(ctx, reviewId, "tutor");
      await ctx.reviews.mutate(reviewId, (draft) => {
        const root = (draft.pages ?? []).find((p) => p.id === "root");
        root?.cards.push({
          id: "central",
          pageId: "root",
          title: "Central",
          collapsed: false,
          revision: 1,
          blocks: [
            { type: "paragraph", id: "b1", text: "The central change folds lines.", citations: [] },
          ],
          undoStack: [],
        } as never);
      });
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/actions`,
        headers: { authorization: "Bearer tok" },
        payload: { kind: "persona", cardId: "central", personaId: "clarity" },
      } as never);
      expect(res.statusCode).toBe(200);
      await waitFor(() => {
        const snap = ctx.reviews.getSnapshot(reviewId);
        const card = (snap?.pages ?? []).flatMap((p) => p.cards).find((c) => c.id === "central");
        return (card?.variants?.["clarity"] as { blocks?: unknown[] } | undefined)?.blocks?.length !== undefined &&
          (card?.variants?.["clarity"] as { blocks: unknown[] }).blocks.length > 0;
      });
      // The persona turn carries its own lens (never the guide lens)...
      // (`listByReview` strips snapshots for size; `get` keeps the full job.)
      const jobs = ctx.jobs.listByReview(reviewId).filter((j) => j.kind === "persona");
      expect(jobs.length).toBeGreaterThan(0);
      const full = jobs.map((j) => ctx.jobs.get(j.id)!);
      const turn = full.map((j) => j.promptSnapshot ?? "").find((t) => t.includes("# Persona lens"));
      expect(turn).toContain("You are Clarity");
      expect(turn).not.toContain(TUTOR_LENS);
      // ...on the base the fork guide built (shared base, fork L0).
      expect(agents.starts.some((s) => s.systemPrompt.includes("FORK-INSTRUCTIONS-SENTINEL"))).toBe(true);
      // Clarity still follows the main model at run time — here the Tutor fork's.
      expect(jobs[0].provider).toBe("codex");
      expect(jobs[0].model).toBe("gpt-6.1-sol");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);
});

describe("re-do with persona + prompt-forks endpoint (fake runner)", () => {
  it("validates the persona and stamps the new review", async () => {
    const agents = pipelineAgents();
    const { dir } = makePipelinePrompts();
    const { app, ctx } = await pipelineApp(agents, dir);
    try {
      const reviewId = "rv_393redo";
      seedBranchReview(ctx, reviewId, GUIDE_PERSONA_ID);
      const authed = { authorization: "Bearer tok" } as never;
      const redo = (id: string, body: unknown) =>
        app.inject({ method: "POST", url: `/api/reviews/${id}/redo`, headers: authed, payload: body } as never);

      // Unknown, disabled and non-guide-capable personas are refused;
      // nothing is deleted by a refusal.
      expect((await redo(reviewId, { personaId: "nope" })).statusCode).toBe(404);
      expect((await redo(reviewId, { personaId: "second-opinion" })).statusCode).toBe(409);
      await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: authed,
        payload: { personas: [...(ctx.settings.get().personas ?? []).map((p) => (p.id === "tutor" ? { ...p, enabled: false } : p))] },
      } as never);
      expect((await redo(reviewId, { personaId: "tutor" })).statusCode).toBe(409);
      await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: authed,
        payload: { personas: [...(ctx.settings.get().personas ?? []).map((p) => (p.id === "tutor" ? { ...p, enabled: true } : p))] },
      } as never);
      expect(ctx.reviews.getSnapshot(reviewId)?.review.id).toBe(reviewId);

      // Re-do with Tutor: same delete + create, the new review records it.
      const ok = await redo(reviewId, { personaId: "tutor" });
      expect(ok.statusCode).toBe(202);
      const created = ok.json() as ReviewSnapshot;
      expect(created.review.id).not.toBe(reviewId);
      expect(created.review.guidePersonaId).toBe("tutor");
      expect(ctx.reviews.getSnapshot(reviewId)).toBeNull();
      expect(ctx.reviews.getSnapshot(created.review.id)?.review.guidePersonaId).toBe("tutor");

      // Plain re-do still records the built-in Guide (a different branch:
      // the Tutor re-do above left a same-source sibling behind, which a
      // same-source re-do would reuse instead of recreating).
      seedBranchReview(ctx, "rv_393redo2", GUIDE_PERSONA_ID, "feature2");
      const plain = await redo("rv_393redo2", {});
      expect(plain.statusCode).toBe(202);
      expect((plain.json() as ReviewSnapshot).review.guidePersonaId).toBe(GUIDE_PERSONA_ID);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  it("lists guide capability and drift per persona", async () => {
    const agents = pipelineAgents();
    const { dir } = makePipelinePrompts();
    const { app } = await pipelineApp(agents, dir);
    try {
      const authed = { authorization: "Bearer tok" } as never;
      const res = await app.inject({ method: "GET", url: "/api/prompt-forks", headers: authed } as never);
      expect(res.statusCode).toBe(200);
      const forks = (res.json() as { forks: { personaId: string; name: string; enabled: boolean; guideCapable: boolean; drifted: string[] }[] }).forks;
      const byId = new Map(forks.map((f) => [f.personaId, f]));
      expect(byId.get("tutor")).toMatchObject({ name: "Tutor", enabled: true, guideCapable: true, drifted: [] });
      expect(byId.get("clarity")).toMatchObject({ guideCapable: false, drifted: [] });
      expect(byId.get("second-opinion")).toMatchObject({ guideCapable: false, drifted: [] });
      // A changed base file shows as drift naming the file.
      writeFileSync(path.join(dir, "reader.md"), `${readFileSync(path.join(dir, "reader.md"), "utf8")}\nNew base rule.\n`);
      const drifted = await app.inject({ method: "GET", url: "/api/prompt-forks", headers: authed } as never);
      const after = (drifted.json() as { forks: { personaId: string; drifted: string[] }[] }).forks;
      expect(after.find((f) => f.personaId === "tutor")?.drifted).toEqual(["reader.md"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  it("persona:fork copies, manifests and refreshes through the service reader", () => {
    const dir = makeBasePrompts();
    try {
      execFileSync(process.execPath, [FORK_SCRIPT, "tutor", "reader", "depth", "--prompts-dir", dir], {
        encoding: "utf8",
        timeout: 30000,
      });
      expect(existsSync(path.join(dir, "personas", "tutor", "reader.md"))).toBe(true);
      expect(readForkManifest(dir, "tutor")?.files).toEqual({
        depth: expect.any(String),
        reader: expect.any(String),
      });
      expect(forkDrift(dir, "tutor")).toEqual([]);
      // A base change drifts; a fork edit + re-run (post-merge) clears it.
      writeFileSync(path.join(dir, "reader.md"), `${readFileSync(path.join(dir, "reader.md"), "utf8")}\nNew base rule.\n`);
      expect(forkDrift(dir, "tutor")).toEqual(["reader.md"]);
      const forkReader = path.join(dir, "personas", "tutor", "reader.md");
      writeFileSync(forkReader, `${readFileSync(forkReader, "utf8")}\nMerged teaching note.\n`);
      execFileSync(process.execPath, [FORK_SCRIPT, "tutor", "reader", "--prompts-dir", dir], {
        encoding: "utf8",
        timeout: 30000,
      });
      expect(readFileSync(forkReader, "utf8")).toContain("Merged teaching note.");
      expect(forkDrift(dir, "tutor")).toEqual([]);
      // Unknown templates are refused without touching the fork.
      expect(() =>
        execFileSync(process.execPath, [FORK_SCRIPT, "tutor", "nope", "--prompts-dir", dir], {
          encoding: "utf8",
          timeout: 30000,
          stdio: "pipe",
        }),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
