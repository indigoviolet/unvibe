/**
 * Second-opinion runner (PRD §4.10, §12).
 *
 * - A run on any card or finding, asking a *different* model (the
 *   `secondOpinion` pick from settings). Refuses with a clear error if it
 *   resolves to the same provider+model as main, pointing at Settings.
 * - Own base (L0 + L1), never a fork of the main base; per-request
 *   topic/claim + cited code goes in the turn. Same read-only MCP tools;
 *   `search_review` / `resolve` are restricted for the `second-opinion`
 *   role (see `mcp/registry.ts`).
 * - Blind (default for findings): only the neutral topic + cited code, not
 *   the finding's claim or assessment. Check (default for cards): the claim
 *   (card text at standard depth) + cited code.
 * - Result stored on the card (attached, not revisable): model label,
 *   verdict, reasoning with validated citations, missed; disagreement
 *   flagged for prominent UI. Re-running replaces the previous result for
 *   the same mode (keep one per mode). Survives depth changes and undo.
 * - Job on the queue at user priority, cancellable, usage recorded, prompt
 *   snapshot stored; dedupe by (card, mode, model, version).
 */
import fs from "node:fs";
import path from "node:path";
import type {
  AgentRunner,
  Block,
  Card,
  Job,
  JobKind,
  Page,
  ReviewSnapshot,
  SecondOpinionMode,
  SecondOpinionResult,
  SecondOpinionVerdict,
  TokenUsage,
} from "@unvibe/shared";
import {
  canonicalizeTarget,
  collectTargets,
  dedupeBlockIds,
  JOB_PRIORITY,
  parseCards,
  parseId,
  renderMarkdown,
  splitReply,
} from "@unvibe/shared";
import { RetryableError } from "../jobs/errors.js";
import type { JobQueue } from "../jobs/index.js";
import type { McpRegistry } from "../mcp/index.js";
import { isReplayRunner } from "../agent/factory.js";
import { withReplayMark } from "../pipeline/replayMark.js";
import { lookupForSnapshot } from "../pipeline/lookup.js";
import { validateReply } from "../validate/index.js";
import { loadTemplatesDirSync, renderTemplate } from "../prompts/index.js";
import type { SessionManager } from "../sessions/manager.js";
import type { SettingsStore } from "../settings/index.js";
import { resolveEffectiveSettings } from "../settings/index.js";
import type { ModelCatalog } from "../settings/index.js";
import type { ReviewStore } from "../state/store.js";
import type { CommandRunner } from "../exec/index.js";
import { buildExcerptMap, readCodeExcerpts } from "./excerpts.js";
import { buildDiffSection, buildSecondOpinionContext, buildSourceBlurb } from "../context/index.js";
import { deriveBlindTopic } from "./topic.js";
import { forkSecondOpinionBase } from "./base.js";
import { toPromptSnapshot } from "../routes/prompts.js";

export interface SecondOpinionDeps {
  reviews: ReviewStore;
  jobs: JobQueue;
  sessions: SessionManager;
  runner: AgentRunner;
  mcp: McpRegistry;
  settings: SettingsStore;
  /** Model catalog for live role defaults (issue #88): same effective settings as GET /api/settings. Absent → stored settings stand. */
  models?: ModelCatalog | null;
  commands: CommandRunner;
  dataDir: string;
  promptsDir: string;
  mcpBaseUrl: string;
  fixturesDir?: string;
}

export interface SecondOpinionRequest {
  reviewId: string;
  cardId: string;
  mode: SecondOpinionMode;
  signal?: AbortSignal;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "model";
}

export function secondOpinionId(cardId: string, mode: SecondOpinionMode, provider: string, model: string): string {
  return `so-${cardId}-${mode}-${slug(provider)}-${slug(model)}`;
}

/** Refuse when the second-opinion pick is the same model as main. */
export function checkDistinctModel(main: { provider: string; model: string }, second: { provider: string; model: string }): void {
  if (main.provider === second.provider && main.model === second.model) {
    throw new Error(
      `Second opinion needs a different model from main (both are ${main.provider}/${main.model}). Pick another second-opinion model in Settings → Models.`,
    );
  }
}

function aliasesForReview(snapshot: ReviewSnapshot, fixturesDir?: string): Record<string, string> {
  if (snapshot.review.repoId !== "demo") return {};
  if (!fixturesDir) return {};
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(fixturesDir, "meta.json"), "utf8")) as {
      keyAliases?: Record<string, string>;
    };
    return meta.keyAliases ?? {};
  } catch {
    return {};
  }
}

function lookupWithAliases(snapshot: ReviewSnapshot, fixturesDir?: string): ReturnType<typeof lookupForSnapshot> {
  const aliases = aliasesForReview(snapshot, fixturesDir);
  if (Object.keys(aliases).length === 0) return lookupForSnapshot(snapshot);
  const base = lookupForSnapshot(snapshot);
  const inner = base.resolveFileKey.bind(base);
  return {
    ...base,
    resolveFileKey: (key: string) => inner(key) ?? (aliases[key] ? inner(aliases[key]) : null),
  };
}

interface ResolvedTarget {
  kind: "card" | "finding" | "expansion";
  page: Page;
  card: Card | null;
  cards: Card[];
  citedIds: string[];
  filePaths: string[];
  claimText: string;
  /** Set when the target is an expansion annotation (M4). */
  expansionId?: string;
}

function filePathsFor(snapshot: ReviewSnapshot, citedIds: string[]): string[] {
  const out: string[] = [];
  for (const id of citedIds) {
    const parsed = parseId(id);
    if (!parsed) continue;
    if (parsed.kind === "diff" || parsed.kind === "h") {
      const f = snapshot.files.find((x) => x.fileKey === parsed.fileKey);
      if (f && !out.includes(f.path)) out.push(f.path);
    } else if (parsed.kind === "code") {
      const m = id.match(/^code:(.+):\d/);
      if (m && !out.includes(m[1])) out.push(m[1]);
    }
  }
  return out;
}

export function resolveTarget(snapshot: ReviewSnapshot, cardId: string): ResolvedTarget {
  // Finding page id (e.g. `f-lf`): all its cards.
  const pageById = snapshot.pages.find((p) => p.id === cardId);
  if (pageById && pageById.kind === "finding") {
    const cards = pageById.cards;
    const cited = new Set<string>();
    for (const c of cards) {
      for (const t of collectTargets(c.blocks).citations) cited.add(t);
    }
    const citedIds = [...cited];
    const claimText =
      `${pageById.title}: ${pageById.summary ?? ""}\n\n` +
      cards.map((c) => `### ${c.title ?? "Untitled"}\n\n${renderMarkdown(c.blocks).trim()}`).join("\n\n").trim();
    return {
      kind: "finding",
      page: pageById,
      card: null,
      cards,
      citedIds,
      filePaths: filePathsFor(snapshot, citedIds),
      claimText: claimText.trim(),
    };
  }
  for (const page of snapshot.pages) {
    const card = page.cards.find((c) => c.id === cardId);
    if (card) {
      const citedIds = [...new Set(collectTargets(card.blocks).citations)];
      const markdown = renderMarkdown(card.blocks).trim();
      const claimText = card.title ? `${card.title}\n\n${markdown}`.trim() : markdown;
      return {
        kind: page.kind === "finding" ? "finding" : "card",
        page,
        card,
        cards: [card],
        citedIds,
        filePaths: filePathsFor(snapshot, citedIds),
        claimText,
      };
    }
  }
  // M4: expansions are cards in their own right — resolve the annotation's
  // embedded blocks so second opinions work there too and survive depth/undo
  // (stored on the expansion body, outside the revisable blocks).
  const expansion = snapshot.annotations.find(
    (a) => a.id === cardId && a.type === "expansion" && a.expansion,
  );
  if (expansion?.expansion) {
    const blocks = expansion.expansion.blocks;
    const citedIds = [...new Set(collectTargets(blocks).citations)];
    const markdown = renderMarkdown(blocks).trim();
    const claimText = expansion.anchor.quotedText
      ? `“${expansion.anchor.quotedText}”\n\n${markdown}`.trim()
      : markdown;
    // Parent page for the blind/check default + prompt context: the page
    // hosting the anchor block when known, else root.
    const hostPage =
      snapshot.pages.find((p) => p.cards.some((c) => c.blocks.some((b) => `block:${b.id}` === `block:${expansion.anchor.host.kind === "block" ? expansion.anchor.host.blockId.split("#").pop() : ""}`))) ??
      snapshot.pages.find((p) => p.kind === "root") ??
      snapshot.pages[0];
    return {
      kind: "expansion",
      page: hostPage,
      card: null,
      cards: [],
      citedIds,
      filePaths: filePathsFor(snapshot, citedIds),
      claimText,
      expansionId: expansion.id,
    };
  }
  throw new Error(`unknown card ${cardId}`);
}

function renderTurn(
  promptsDir: string,
  mode: SecondOpinionMode,
  vars: { topic?: string; claim?: string; cited_code: string },
): string {
  const lib = loadTemplatesDirSync(promptsDir);
  const name = mode === "blind" ? "second_opinion_blind" : "second_opinion_check";
  const tpl = lib.get(name);
  if (!tpl) throw new Error(`missing prompt template ${name}`);
  return renderTemplate(tpl, vars as Record<string, string>);
}

async function collectStreaming(
  runner: AgentRunner,
  session: { id: string; provider: string; model: string },
  prompt: string,
  signal: AbortSignal | undefined,
  onDelta: (delta: string) => void,
): Promise<{ text: string; usage: TokenUsage }> {
  let text = "";
  const usage: TokenUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
  for await (const ev of runner.prompt(session, prompt, signal)) {
    if (ev.type === "text") {
      text += ev.delta;
      onDelta(ev.delta);
    } else if (ev.type === "usage") {
      usage.inputTokens += ev.inputTokens;
      usage.cachedTokens += ev.cachedTokens;
      usage.outputTokens += ev.outputTokens;
    } else if (ev.type === "error") {
      if (ev.retryable) throw new RetryableError(ev.message);
      throw new Error(ev.message);
    }
    if (signal?.aborted) throw new Error("aborted");
  }
  return { text, usage };
}

function worktreeOf(dataDir: string, reviewId: string): string {
  return path.join(dataDir, "worktrees", reviewId);
}

async function getWorktreePath(
  deps: SecondOpinionDeps,
  reviewId: string,
): Promise<string | null> {
  try {
    // ReviewReader is wired via McpRegistry's reader; ask it directly when
    // available, else fall back to the conventional worktree path.
    const reader = (deps.mcp as unknown as { opts?: { reader?: { getWorktreePath?: (id: string) => unknown } } }).opts?.reader;
    if (reader?.getWorktreePath) {
      const p = await reader.getWorktreePath(reviewId);
      if (typeof p === "string" && p) return p;
    }
  } catch {
    // fall through
  }
  return worktreeOf(deps.dataDir, reviewId);
}

export interface BuiltSecondOpinionPrompt {
  turn: string;
  topic: string;
  claim: string;
  citedIds: string[];
  includedIds: string[];
  missingIds: string[];
  citedCode: string;
  version: number;
}

/**
 * Build the per-request turn (topic/claim + cited code). Pure except for
 * worktree `code:` reads. The blind prompt never contains the claim text:
 * the topic comes only from cited locations (see `topic.ts`).
 */
export async function buildSecondOpinionPrompt(
  deps: SecondOpinionDeps,
  reviewId: string,
  cardId: string,
  mode: SecondOpinionMode,
): Promise<BuiltSecondOpinionPrompt> {
  const snapshot = deps.reviews.getSnapshot(reviewId);
  if (!snapshot) throw new Error(`unknown review ${reviewId}`);
  const target = resolveTarget(snapshot, cardId);
  const settings = await resolveEffectiveSettings({ settings: deps.settings, models: deps.models ?? null });
  // L1 source for the isolated base (instructions + sourceText travel via
  // the base session; only cited excerpts travel in the turn's cited_code).
  const promptSnap = toPromptSnapshot(snapshot, { model: settings.secondOpinion.model });
  const sourceText = [buildSourceBlurb(promptSnap), buildDiffSection(promptSnap, { inlineBudgetTokens: settings.inlineBudgetTokens }).text].join("\n");
  const lib = loadTemplatesDirSync(deps.promptsDir);
  const instructionsTpl = lib.get("instructions");
  const instructions = instructionsTpl ? renderTemplate(instructionsTpl, {}) : "";
  const baseExcerpts = await buildExcerptMap({ snapshot });
  const worktreePath = await getWorktreePath(deps, reviewId);
  const codeExcerpts = await readCodeExcerpts(target.citedIds, snapshot.version.headSha, worktreePath, deps.commands);
  const allExcerpts = [...baseExcerpts, ...codeExcerpts];
  const ctx = buildSecondOpinionContext({
    instructions,
    sourceText,
    codeExcerpts: allExcerpts,
    citedIds: target.citedIds,
  });
  // `citedCode` is the excerpt list of the isolated context (the
  // per-request part that goes in the turn's `{{cited_code}}`). The
  // template already carries the `## Cited code` header, so strip the
  // helper's header here to avoid duplicating it.
  let citedCode = ctx.text.slice((instructions + "\n" + sourceText + "\n").length).trim();
  citedCode = citedCode.replace(/^## Cited code\s*\n+/, "").trim() || "(no cited code available)";
  const topic = mode === "blind" ? deriveBlindTopic({ citedIds: target.citedIds, filePaths: target.filePaths }) : "";
  const claim = mode === "check" ? target.claimText : "";
  const turn =
    mode === "blind"
      ? renderTurn(deps.promptsDir, mode, { topic, cited_code: citedCode })
      : renderTurn(deps.promptsDir, mode, { claim, cited_code: citedCode });
  return {
    turn,
    topic,
    claim,
    citedIds: target.citedIds,
    includedIds: ctx.includedIds,
    missingIds: ctx.missingIds,
    citedCode,
    version: snapshot.version.n,
  };
}

function parseVerdict(raw: unknown): SecondOpinionVerdict {
  const v = typeof raw === "string" ? raw.toLowerCase() : "";
  if (v === "agrees" || v === "partly" || v === "disagrees") return v;
  throw new Error(`second-opinion verdict must be agrees|partly|disagrees, got ${JSON.stringify(raw)}`);
}

function withValidation(
  snapshot: ReviewSnapshot,
  blocks: Block[],
  validation: ReturnType<typeof validateReply>,
  fixturesDir?: string,
): Block[] {
  const lookup = lookupWithAliases(snapshot, fixturesDir);
  const resolve = lookup.resolveFileKey.bind(lookup);
  const byTarget = new Map(validation.tokens.map((t) => [t.target, t]));
  const mark = (citations: { target: string; unverified?: boolean }[]): { target: string; unverified?: boolean }[] =>
    citations.map((c) => {
      const rep = byTarget.get(c.target);
      if (rep?.status === "repaired" && rep.repairedTo) {
        return { target: canonicalizeTarget(rep.repairedTo, resolve) };
      }
      if (rep?.status === "unverified") return { target: c.target, unverified: true };
      return { target: canonicalizeTarget(c.target, resolve) };
    });
  return blocks.map((b) => {
    switch (b.type) {
      case "paragraph":
        return { ...b, citations: mark(b.citations) };
      case "list":
        return {
          ...b,
          items: b.items.map((it) => ({ ...it, citations: mark(it.citations) })),
          citations: mark(b.citations),
        };
      case "table":
      case "code":
      case "diagram":
      case "finding-link":
      case "follow-up":
        return { ...b, citations: mark((b as { citations: { target: string }[] }).citations) };
      case "comment-link":
        return {
          ...b,
          diffRef: canonicalizeTarget(b.diffRef, resolve),
          citations: mark(b.citations),
        };
      case "aside":
        return { ...b, inner: withValidation(snapshot, b.inner, validation, fixturesDir), citations: mark(b.citations) };
    }
  });
}

/**
 * Find a stored second-opinion result for the identical request
 * (card, mode, model, version). Used for PRD §12 cross-request reuse (#10):
 * a repeat returns the stored result with no agent call. A deleted result
 * (removeSecondOpinion) or a new base version (version mismatch) or a
 * model change is legitimately a new request.
 */
export function findStoredSecondOpinion(
  snapshot: ReviewSnapshot,
  cardId: string,
  mode: SecondOpinionMode,
  provider: string,
  model: string,
  version: number,
): SecondOpinionResult | null {
  const matches = (s: SecondOpinionResult): boolean =>
    s.mode === mode && s.provider === provider && s.model === model && s.version === version;
  const expansion = snapshot.annotations.find(
    (a) => a.id === cardId && a.type === "expansion" && a.expansion,
  );
  if (expansion?.expansion?.secondOpinions) {
    const hit = expansion.expansion.secondOpinions.find(matches);
    if (hit) return hit;
  }
  for (const page of snapshot.pages) {
    // Finding page id: results attach to its cards (first card normally).
    if (page.id === cardId) {
      for (const c of page.cards) {
        const hit = (c.secondOpinions ?? []).find(matches);
        if (hit) return hit;
      }
    }
    for (const c of page.cards) {
      if (c.id !== cardId) continue;
      const hit = (c.secondOpinions ?? []).find(matches);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Enqueue a second-opinion run. Returns the job (deduped), or a reused
 * marker when the stored result for the identical request already exists.
 * The job's `promptSnapshot` is the per-request turn; its `cardId` is the
 * target card (or finding page) so the UI can show working state.
 */
export async function requestSecondOpinion(
  deps: SecondOpinionDeps,
  req: SecondOpinionRequest,
): Promise<Job | { reused: true }> {
  const snapshot = deps.reviews.getSnapshot(req.reviewId);
  if (!snapshot) throw new Error(`unknown review ${req.reviewId}`);
  const settings = await resolveEffectiveSettings({ settings: deps.settings, models: deps.models ?? null });
  checkDistinctModel(settings.main, settings.secondOpinion);
  const target = resolveTarget(snapshot, req.cardId);
  const version = snapshot.version.n;
  const provider = settings.secondOpinion.provider;
  const model = settings.secondOpinion.model;
  const kind: JobKind = "second-opinion";
  // PRD §12 reuse (#10): identical stored result (same card, mode, model,
  // base version) returns without an agent call — no job, no tokens.
  if (findStoredSecondOpinion(snapshot, req.cardId, req.mode, provider, model, version)) {
    return { reused: true };
  }
  // Dedupe by (card, mode, model, version): identical requests share one
  // job/result while the first is still active (PRD §12).
  const dedupe = {
    anchor: `card:${req.cardId}`,
    requestKind: `second-opinion:${req.mode}`,
    baseVersion: `v${version}:${provider}:${model}`,
  };
  const built = await buildSecondOpinionPrompt(deps, req.reviewId, req.cardId, req.mode);
  let turn = built.turn;
  if (isReplayRunner(deps.runner)) {
    // Replay key selects the fixture recording: finding blinds use the
    // finding page id, card checks use the card id.
    const replayKey = target.kind === "finding" && target.page.id.startsWith("f-")
      ? `${target.page.id}:${req.mode}`
      : `${req.cardId}:${req.mode}`;
    turn = withReplayMark(turn, { kind: "second-opinion", key: replayKey });
  }
  const cardIdForJob = target.card ? target.card.id : target.page.id;
  const job = deps.jobs.enqueue({
    reviewId: req.reviewId,
    kind,
    provider,
    model,
    priority: JOB_PRIORITY.userRequested,
    dedupe,
    cardId: cardIdForJob,
    promptSnapshot: turn,
    run: async (ctx) => {
      ctx.setPromptSnapshot(turn);
      const forked = await forkSecondOpinionBase(
        {
          reviews: deps.reviews,
          sessions: deps.sessions,
          runner: deps.runner,
          mcp: deps.mcp,
          settings: deps.settings,
          dataDir: deps.dataDir,
          promptsDir: deps.promptsDir,
          mcpBaseUrl: deps.mcpBaseUrl,
        },
        req.reviewId,
      );
      ctx.setSessionId(forked.session.id);
      try {
        const { text, usage } = await collectStreaming(
          deps.runner,
          forked.session,
          turn,
          req.signal ?? ctx.signal,
          (d) => ctx.reportText(d),
        );
        const split = splitReply(text);
        if (!split.ok && (split.error.kind === "malformed" || split.error.kind === "not-object")) {
          throw new Error(`the agent's reply was not in the expected format (${split.error.kind}: ${split.error.message})`);
        }
        const body = split.body;
        const cards = parseCards(body);
        const live = deps.reviews.getSnapshot(req.reviewId);
        if (!live) throw new Error(`unknown review ${req.reviewId}`);
        const lookup = lookupWithAliases(live, deps.fixturesDir);
        const blocks = cards.flatMap((c) => c.blocks);
        const validation = validateReply(blocks, lookup);
        let finalText = text;
        let finalBlocks = blocks;
        let finalData = split.ok ? split.data : null;
        let finalValidation = validation;
        if (validation.needsRepairTurn) {
          let repairPrompt =
            `Some citations in your previous reply could not be verified:\n` +
            validation.tokens
              .filter((t) => t.status === "unverified")
              .map((t) => `- ${t.target}: ${t.reason ?? "unknown"}`)
              .join("\n") +
            `\nReply with the same content and corrected citation tokens. End with the same trailing JSON block.`;
          if (isReplayRunner(deps.runner)) {
            const replayKey =
              target.kind === "finding" && target.page.id.startsWith("f-")
                ? `${target.page.id}:${req.mode}`
                : `${req.cardId}:${req.mode}`;
            repairPrompt = withReplayMark(repairPrompt, { kind: "second-opinion", key: replayKey });
          }
          const repair = await collectStreaming(deps.runner, forked.session, repairPrompt, req.signal ?? ctx.signal, (d) =>
            ctx.reportText(d),
          );
          usage.inputTokens += repair.usage.inputTokens;
          usage.cachedTokens += repair.usage.cachedTokens;
          usage.outputTokens += repair.usage.outputTokens;
          const secondSplit = splitReply(repair.text);
          if (!secondSplit.ok && (secondSplit.error.kind === "malformed" || secondSplit.error.kind === "not-object")) {
            throw new Error(`the agent's reply was not in the expected format (${secondSplit.error.kind}: ${secondSplit.error.message})`);
          }
          finalText = repair.text;
          finalBlocks = parseCards(secondSplit.body).flatMap((c) => c.blocks);
          finalData = secondSplit.ok ? secondSplit.data : null;
          const secondValidation = validateReply(
            finalBlocks,
            lookupWithAliases(deps.reviews.getSnapshot(req.reviewId)!, deps.fixturesDir),
          );
          finalValidation = secondValidation;
        }
        const so = (finalData as unknown as { secondOpinion?: { verdict?: unknown; reasoning?: unknown; missed?: unknown } } | null)?.secondOpinion;
        if (!so || typeof so !== "object") {
          throw new Error("the second opinion's reply was not in the expected format");
        }
        const verdict = parseVerdict((so as { verdict?: unknown }).verdict);
        const reasoningRaw = (so as { reasoning?: unknown }).reasoning;
        const missedRaw = (so as { missed?: unknown }).missed;
        const reasoning = typeof reasoningRaw === "string" ? reasoningRaw : body.trim().slice(0, 2000);
        const missed =
          typeof missedRaw === "string" ? missedRaw : Array.isArray(missedRaw) ? missedRaw.join("\n") : undefined;
        // One reasoning body may flatten several reply cards (#116):
        // dedupe repeated block IDs so one anchor matches one block.
        const fixedBlocks = dedupeBlockIds(withValidation(live, finalBlocks, finalValidation, deps.fixturesDir));
        const now = Date.now();
        const result: SecondOpinionResult = {
          id: secondOpinionId(req.cardId, req.mode, provider, model),
          cardId: req.cardId,
          mode: req.mode,
          provider,
          model,
          verdict,
          reasoning,
          blocks: fixedBlocks,
          ...(missed ? { missed } : {}),
          version,
          createdAt: now,
          jobId: job.id,
        };
        void finalText;
        // Remove while in flight cancels this job (issue #76): a result
        // arriving after the abort must not resurrect the block.
        if (ctx.signal.aborted || req.signal?.aborted) return;
        // Store on the card (attached, not revisable): replace any entry
        // with the same mode (keep one per mode), keep the other mode.
        // Expansions store on the expansion body so depth/undo leave the
        // result attached (M4).
        await deps.reviews.mutate(req.reviewId, (draft) => {
          if (target.expansionId) {
            const ann = (draft.annotations as unknown as import("@unvibe/shared").Annotation[]).find(
              (a) => a.id === target.expansionId,
            );
            if (!ann || ann.type !== "expansion" || !ann.expansion) {
              throw new Error(`unknown card ${req.cardId}`);
            }
            const rest = (ann.expansion.secondOpinions ?? []).filter((s) => s.mode !== req.mode);
            ann.expansion.secondOpinions = [...rest, { ...result, cardId: ann.id }];
            const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
            draft.logTail.push({
              seq,
              kind: "second-opinion",
              payload: { cardId: req.cardId, mode: req.mode, verdict, model },
              scope: { scope: "global" },
            });
            return;
          }
          const pages = draft.pages;
          let stored = false;
          // Finding page target: attach to its first card (Evidence) so the
          // result renders on the finding page; card target: attach there.
          const attachCardId = target.card ? target.card.id : target.cards[0]?.id ?? req.cardId;
          for (const p of pages) {
            const c = p.cards.find((x) => x.id === attachCardId);
            if (c) {
              const rest = (c.secondOpinions ?? []).filter((s) => s.mode !== req.mode);
              c.secondOpinions = [...rest, { ...result, cardId: c.id }];
              stored = true;
              break;
            }
          }
          if (!stored) {
            // Fallback: attach to the requested id even if the card moved.
            for (const p of pages) {
              const c = p.cards.find((x) => x.id === req.cardId);
              if (c) {
                const rest = (c.secondOpinions ?? []).filter((s) => s.mode !== req.mode);
                c.secondOpinions = [...rest, result];
                stored = true;
                break;
              }
            }
          }
          if (!stored) throw new Error(`unknown card ${req.cardId}`);
          const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
          draft.logTail.push({
            seq,
            kind: "second-opinion",
            payload: { cardId: req.cardId, mode: req.mode, verdict, model },
            scope: { scope: "global" },
          });
        });
        ctx.reportUsage(usage);
        try {
          await deps.reviews.mutate(req.reviewId, (draft) => {
            const t = draft.usageTotals ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0, createdAt: draft.review.createdAt };
            t.inputTokens += usage.inputTokens;
            t.cachedTokens += usage.cachedTokens;
            t.outputTokens += usage.outputTokens;
            t.cacheHitRate =
              t.inputTokens + t.cachedTokens > 0 ? t.cachedTokens / (t.inputTokens + t.cachedTokens) : undefined;
            draft.usageTotals = t;
          });
        } catch {
          // best-effort
        }
      } finally {
        // Forked sessions are lightweight; leave them for idle sweep.
      }
    },
  });
  return job;
}

/** Remove a second-opinion result (re-run replaces; remove deletes). */
export async function removeSecondOpinion(
  deps: Pick<SecondOpinionDeps, "reviews">,
  reviewId: string,
  cardId: string,
  mode?: SecondOpinionMode,
  opinionId?: string,
): Promise<void> {
  await deps.reviews.mutate(reviewId, (draft) => {
    let found = false;
    // M4: expansions carry their results on the expansion body.
    for (const a of draft.annotations as unknown as import("@unvibe/shared").Annotation[]) {
      if (a.id !== cardId) continue;
      if (a.type !== "expansion" || !a.expansion) continue;
      const before = a.expansion.secondOpinions ?? [];
      const after = before.filter((s) => {
        if (opinionId && s.id === opinionId) return false;
        if (opinionId && s.id !== opinionId) return true;
        if (mode && s.mode === mode) return false;
        if (!mode && !opinionId && s.cardId === cardId) return false;
        return true;
      });
      if (after.length !== before.length) {
        a.expansion.secondOpinions = after;
        found = true;
      }
    }
    // Opinion ids are globally unique (`so-<card>-…`): also match by id
    // alone so `delete` with a stored `so-…` id works without a card.
    if (opinionId && !found) {
      for (const a of draft.annotations as unknown as import("@unvibe/shared").Annotation[]) {
        if (a.type !== "expansion" || !a.expansion) continue;
        const before = a.expansion.secondOpinions ?? [];
        if (before.some((s) => s.id === opinionId)) {
          a.expansion.secondOpinions = before.filter((s) => s.id !== opinionId);
          found = true;
          break;
        }
      }
    }
    for (const p of draft.pages) {
      for (const c of p.cards) {
        if (opinionId && (c.secondOpinions ?? []).some((s) => s.id === opinionId)) {
          c.secondOpinions = (c.secondOpinions ?? []).filter((s) => s.id !== opinionId);
          found = true;
          continue;
        }
        if (c.id !== cardId && p.id !== cardId) continue;
        const before = c.secondOpinions ?? [];
        const after = before.filter((s) => {
          if (opinionId && s.id === opinionId) return false;
          if (mode && s.mode === mode && !opinionId) return false;
          if (!mode && !opinionId && s.cardId === cardId) return false;
          return true;
        });
        // When addressed by finding page id, clear matching mode across its cards.
        if (p.id === cardId && p.kind === "finding") {
          if (opinionId) {
            if (before.some((s) => s.id === opinionId)) found = true;
            c.secondOpinions = after;
          } else if (mode) {
            if (before.some((s) => s.mode === mode)) found = true;
            c.secondOpinions = after;
          }
        } else if (c.id === cardId) {
          if (after.length !== before.length) found = true;
          c.secondOpinions = after;
        }
      }
    }
    if (!found) throw new Error(`unknown second opinion ${opinionId ?? `${cardId}:${mode ?? ""}`}`);
  });
}
