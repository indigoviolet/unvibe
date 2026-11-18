/**
 * Explain-since-X pass (#413): manual only, one agent call on click.
 *
 * The reviewer picks X (an earlier version, any PR commit, or their last
 * GitHub review); the end is always the current head. The job renders
 * `prompts/explain_pass.md`, runs it via the injected base runner (a
 * fork of the new base), parses the trailing JSON block, and applies the
 * result in one `ReviewStore.mutate`: the Changes-since-X section is
 * replaced whole. The old guide is left untouched — no revised cards,
 * no finding rechecks, no new findings, no hunk summaries, no plotline
 * placement, no pinning.
 *
 * Narrow dependencies (the base-building pipeline is another agent's):
 *
 * ```ts
 * interface ExplainBaseRunner {
 *   runExplainPrompt(prompt: string, opts: { reviewId: string; toVersion: number; signal?: AbortSignal }): Promise<string>;
 * }
 * interface ExplainReplyParser { parseReply(text: string): ExplainPassResult; }
 * ```
 */
import fs from "node:fs";
import path from "node:path";
import type {
  Card,
  ExplainPassResult,
  Job,
  ReviewSnapshot,
  SinceBaseline,
  SinceHunks,
  TokenUsage,
} from "@unvibe/shared";
import { GUIDE_PERSONA_ID, isSinceBaseline, JOB_PRIORITY } from "@unvibe/shared";
import { withGuideStyleForReview } from "../prompts/personas.js";
import {
  buildSinceSectionCards,
  formatSinceContext,
  normalizeAgentSinceCards,
  resolveSinceBaseline,
  type SinceCardDraftWithRefs,
} from "./since.js";
import {
  charTokenEstimator,
  countCodePoints,
  DEFAULT_BASE_PROMPT_CAP_TOKENS,
} from "../context/tokens.js";
import type { JobQueue } from "../jobs/index.js";
import type { ReviewStore } from "../state/store.js";

/** Issue #194: live reporting hooks from the enclosing job. */
export interface ExplainRunHooks {
  setSessionId(id: string): void;
  reportText(delta: string): void;
  reportTool: import("../pipeline/runner.js").ToolCallback;
  reportUsage(usage: TokenUsage): void;
  setTurnPrompt?: (text: string) => void;
  reportTurnUsage?: (usage: TokenUsage, raw?: unknown) => void;
}

export interface ExplainBaseRunner {
  runExplainPrompt(
    prompt: string,
    opts: { reviewId: string; toVersion: number; signal?: AbortSignal; hooks?: ExplainRunHooks },
  ): Promise<string>;
}

export interface ExplainReplyParser {
  parseReply(text: string): ExplainPassResult;
}

export interface ExplainPassDeps {
  jobs: JobQueue;
  reviews: ReviewStore;
  baseRunner: ExplainBaseRunner;
  parser: ExplainReplyParser;
  /** Defaults to `resolvePromptsDir()`; tests pass a fixture dir. */
  promptsDir?: string;
  provider?: string;
  model?: string;
  effort: string;
  /**
   * Issue #393: the review's Guide persona (template + lens source).
   * Absent means the built-in Guide (shared template, no lens).
   */
  guidePersonaId?: string;
  lens?: string;
}

/** Format one hunk for the `{{x_hunks}}` variable. */
export function formatXHunk(
  fileKey: string,
  filePath: string,
  contentHash: string,
  header: string,
  lines: { kind: string; text: string }[],
): string {
  const rows = lines
    .map((l) => (l.kind === "add" ? `+${l.text}` : l.kind === "del" ? `-${l.text}` : ` ${l.text}`))
    .join("\n");
  return `### [[h:${fileKey}:${contentHash}]] ${filePath}\n${header}\n${rows}`;
}

/**
 * Build the `explain_pass` variables from the current snapshot and the
 * X→head hunk set (computed by the route: version X from stored diffs,
 * commit X through git). Pure.
 */
export function buildExplainVariables(
  snapshot: ReviewSnapshot,
  since: SinceHunks,
  opts: { capTokens?: number; baseline?: SinceBaseline } = {},
): { x_hunks: string; x_context: string } {
  const ids = new Set([...since.added, ...since.changed]);
  const chunks: string[] = [];
  for (const f of snapshot.files) {
    for (const h of f.hunks) {
      if (ids.has(`h:${f.fileKey}:${h.contentHash}`)) {
        chunks.push(formatXHunk(f.fileKey, f.path, h.contentHash, h.header, h.lines));
      }
    }
  }
  return {
    x_hunks: capXHunks(chunks, opts.capTokens ?? DEFAULT_BASE_PROMPT_CAP_TOKENS),
    x_context: formatSinceContext(snapshot, since, opts.baseline),
  };
}

/**
 * Cap the `{{x_hunks}}` variable at the hard cap (issue #107): a range
 * touching thousands of hunks must not overflow the prompt. Keeps the
 * first chunks that fit, in input order, plus a notice naming what was
 * left out and how to reach it. Pure.
 */
function capXHunks(chunks: string[], capTokens: number): string {
  if (chunks.length === 0) return "(no hunks changed since X — X is the head or its content matches the head)";
  const full = chunks.join("\n\n");
  if (charTokenEstimator.estimateTokens(full) <= capTokens) return full;
  const points = chunks.map(countCodePoints);
  const estimatePoints = (n: number): number => (n === 0 ? 0 : Math.max(1, Math.ceil(n / 4)));
  const kept: string[] = [];
  let keptPoints = 0;
  for (let i = 0; i < chunks.length; i++) {
    const probe = keptPoints + (kept.length > 0 ? 2 : 0) + (points[i] ?? 0);
    if (estimatePoints(probe) > capTokens) break;
    kept.push(chunks[i]);
    keptPoints = probe;
  }
  const notice = (omitted: number): string =>
    `(+${omitted} more changed hunks omitted to fit the ${capTokens}-token prompt cap; ` +
    "fetch any hunk with `get_hunk`)";
  let omitted = chunks.length - kept.length;
  while (kept.length > 0) {
    const withNotice = keptPoints + 2 + countCodePoints(notice(omitted));
    if (estimatePoints(withNotice) <= capTokens) break;
    keptPoints -= (points[kept.length - 1] ?? 0) + (kept.length > 1 ? 2 : 0);
    kept.pop();
    omitted = chunks.length - kept.length;
  }
    return kept.length > 0 ? [...kept, notice(omitted)].join("\n\n") : notice(omitted);
}

/**
 * Render the explain-pass template. Pure I/O: reads one file. Issue
 * #393: when the review's Guide persona forks `explain_pass.md`, the
 * fork (whole file) renders instead.
 */
export function renderExplainPrompt(
  promptsDir: string,
  vars: { x_hunks: string; x_context: string },
  guidePersonaId?: string,
): string {
  const forkFile =
    guidePersonaId !== undefined && guidePersonaId !== GUIDE_PERSONA_ID
      ? path.join(promptsDir, "personas", guidePersonaId, "explain_pass.md")
      : null;
  const raw = fs.readFileSync(
    forkFile !== null && fs.existsSync(forkFile) ? forkFile : path.join(promptsDir, "explain_pass.md"),
    "utf8",
  );
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  return body.replace("{{x_hunks}}", vars.x_hunks).replace("{{x_context}}", vars.x_context);
}

export function resolveExplainPromptsDir(explicit?: string): string | null {
  if (explicit) return explicit;
  const override = process.env.UNVIBE_PROMPTS_DIR;
  if (override && fs.existsSync(path.join(override, "explain_pass.md"))) return override;
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, "prompts");
    if (fs.existsSync(path.join(candidate, "explain_pass.md"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Default trailing-JSON-block parser (PRD §10): the agent ends its reply
 * with one fenced ` ```json ` block carrying the structured fields. Throws
 * on missing/invalid blocks so the job visibly errors instead of applying
 * half a result.
 */
export class JsonBlockReplyParser implements ExplainReplyParser {
  parseReply(text: string): ExplainPassResult {
    const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
    if (blocks.length === 0) throw new Error("the agent's reply was not in the expected format");
    const raw = (blocks[blocks.length - 1][1] ?? "").trim();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`the agent's reply was not in the expected format: trailing JSON block does not parse: ${(err as Error).message}`);
    }
    const baseline = isSinceBaseline(json["baseline"]) ? (json["baseline"] as ExplainPassResult["baseline"]) : undefined;
    const sinceHunks = normalizeExplainSinceHunks(json["sinceHunks"]);
    const sinceCards = normalizeAgentSinceCards(json["sinceSection"]);
    return {
      ...(baseline !== undefined ? { baseline } : {}),
      ...(sinceHunks !== undefined ? { sinceHunks } : {}),
      ...(sinceCards !== undefined ? { sinceSection: { cards: sinceCards } } : {}),
    };
  }
}

function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((e) => typeof e === "string")) return null;
  return [...v];
}

function normalizeExplainSinceHunks(v: unknown): SinceHunks | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const added = stringArray(o["added"]) ?? [];
  const changed = stringArray(o["changed"]) ?? [];
  if (!Array.isArray(o["added"]) || !Array.isArray(o["changed"])) return undefined;
  return { added, changed };
}

/** Agent-shaped since cards with the service-resolved shape. Re-exported for tests. */
export type { SinceCardDraftWithRefs };

/**
 * Apply an explain-pass result in one mutate (#413): the Changes-since-X
 * section is replaced whole (stored only when cards with bodies remain —
 * bodyless model cards fail in the shared builder, #411). The baseline
 * the run explained from is recorded; the old guide is untouched.
 */
export async function applyExplainResult(
  reviews: ReviewStore,
  reviewId: string,
  result: ExplainPassResult,
): Promise<void> {
  await reviews.mutate(reviewId, (draft) => {
    const toVersion = draft.review.currentVersion;
    const baselineV: SinceBaseline =
      result.baseline && isSinceBaseline(result.baseline) ? result.baseline : resolveSinceBaseline(draft);
    const now = Date.now();
    if (result.sinceSection && result.sinceSection.cards.length > 0) {
      // Issue #413: a reply that names cards but stores none is
      // unusable (cf. the bodyless-card rule #411) — not an empty
      // range. Fail the job loudly instead of landing "done" with
      // nothing stored; a genuinely empty reply (no cards named)
      // still lands done and the UI says there was nothing to explain.
      const cards: Card[] = buildSinceSectionCards(draft, result.sinceSection.cards as SinceCardDraftWithRefs[]);
      if (cards.length === 0) {
        throw new Error("The explain run's reply had no usable cards; try again");
      }
      draft.sinceSection = { baseline: baselineV, headVersion: toVersion, at: now, cards };
    }
    if (result.sinceHunks) {
      const clean = (ids: unknown): string[] =>
        Array.isArray(ids) ? ids.filter((e): e is string => typeof e === "string") : [];
      draft.sinceHunks = { added: clean(result.sinceHunks.added), changed: clean(result.sinceHunks.changed) };
      draft.sinceBaseline = baselineV;
    }
    const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
    draft.logTail.push({
      seq,
      kind: "explain-pass",
      payload: {
        sinceAdded: result.sinceHunks?.added.length ?? 0,
        sinceChanged: result.sinceHunks?.changed.length ?? 0,
      },
      scope: { scope: "global" },
    });
  });
}

/**
 * Enqueue the explain pass as an `explain-pass` job. Resolves with the
 * job; the job's `run` renders the prompt, calls the base runner,
 * parses, and applies. `baseline`/`since` are the X the route resolved
 * (version X from stored diffs, commit X through git); when absent the
 * job falls back to the stored/default baseline and its hunk set.
 */
export function enqueueExplainPass(
  deps: ExplainPassDeps,
  opts: { reviewId: string; toVersion: number; baseline?: SinceBaseline; since?: SinceHunks },
): Job {
  const snapshot = deps.reviews.getSnapshot(opts.reviewId);
  if (!snapshot) throw new Error(`unknown review ${opts.reviewId}`);

  const promptsDir = resolveExplainPromptsDir(deps.promptsDir);
  if (!promptsDir) throw new Error("explain pass: no prompts dir (set UNVIBE_PROMPTS_DIR)");

  const provider = deps.provider ?? "main";
  const model = deps.model ?? "main-model";
  const effort = deps.effort;
  return deps.jobs.enqueue({
    reviewId: opts.reviewId,
    kind: "explain-pass",
    provider,
    model,
    effort,
    priority: JOB_PRIORITY.userRequested,
    dedupe: { anchor: "explain", requestKind: "explain-pass", baseVersion: `v${opts.toVersion}` },
    run: async (ctx) => {
      const live = deps.reviews.getSnapshot(opts.reviewId) ?? snapshot;
      const baseline = opts.baseline ?? resolveSinceBaseline(live);
      const since = opts.since ?? live.sinceHunks ?? { added: [], changed: [] };
      const vars = buildExplainVariables(live, since, { baseline });
      // Issue #393: fork template + the review's Guide persona lens
      // (built-in: shared template, no lens — exactly as before).
      const forkGuide = deps.guidePersonaId !== undefined && deps.guidePersonaId !== GUIDE_PERSONA_ID;
      const prompt = withGuideStyleForReview(
        "explain_pass",
        renderExplainPrompt(promptsDir, vars, deps.guidePersonaId),
        deps.lens ?? "",
        forkGuide,
      );
      ctx.setPromptSnapshot(prompt);
      // Issue #194: the runner executes directly in this job (no nested
      // enqueue — that deadlocked on this job's own dedupe key and sat
      // RUNNING with no token counts). Hooks stream its progress here.
      ctx.beginTurn("explain");
      let reply: string;
      try {
        reply = await deps.baseRunner.runExplainPrompt(prompt, {
          reviewId: opts.reviewId,
          toVersion: opts.toVersion,
          signal: ctx.signal,
          hooks: {
            setSessionId: (id) => ctx.setSessionId(id),
            reportText: (d) => ctx.reportText(d),
            reportTool: (n, d, extra) => ctx.reportTool(n, d, extra),
            reportUsage: (u) => ctx.reportUsage(u),
            setTurnPrompt: (text) => ctx.setTurnPrompt(text),
            reportTurnUsage: (u, raw) => ctx.reportTurnUsage(u, raw),
          },
        });
      } finally {
        ctx.endTurn();
      }
      const result = deps.parser.parseReply(reply);
      // The run explains the X the reviewer chose: the prompt names
      // it, so the request wins over whatever the reply echoes.
      result.baseline = baseline;
      result.sinceHunks = since;
      await applyExplainResult(deps.reviews, opts.reviewId, result);
    },
  });
}
