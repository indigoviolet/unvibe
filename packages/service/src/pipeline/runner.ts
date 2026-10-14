/**
 * M3 pipeline (PRD §11): reader → base → critic/concepts → hunk pass.
 *
 * Every agent call is a job on the queue (kind, model, priority, prompt
 * snapshot, usage with cached tokens, cardId/progress). Streaming reader
 * cards go through `parseCardsPartial` → `ReviewStore.mutate` so the UI
 * fills progressively (finished cards only: sections closed by a later
 * `## ` heading, or all sections once the trailing JSON block lands).
 * Every reply goes through `splitReply` → parser →
 * citation validator (valid/repaired stored resolved, unverified flagged +
 * recorded in job debug data; one repair turn when `needsRepairTurn`).
 *
 * Resilience (PRD §16): snapshots + revs are durable; interrupted stages
 * are resumable via `resumeReview`. Sessions reopen with `load` or rebuild.
 * Measurement (PRD §16): per-review token totals + cache-hit rate in
 * `snapshot.usageTotals`, time-to-first-card logged.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  AgentRunner,
  Block,
  Job,
  JobKind,
  ParsedCard,
  ReplyData,
  ReviewSnapshot,
  TokenUsage,
} from "@unvibe/shared";
import { canonicalizeTarget, DEFAULT_GUIDE_TITLE, JOB_PRIORITY, normalizePlotlines, parseCards, parseCardsPartial, parseHunkReply, parseId, PLOTLINE_ASSIGN_CAP, resolveHunkScore, splitReply } from "@unvibe/shared";
import type { HunkReplyResult } from "@unvibe/shared";
import { DegradedConnError, DegradedTurnError, RetryableError } from "../jobs/errors.js";
import type { JobQueue } from "../jobs/index.js";
import { McpRegistry } from "../mcp/index.js";
import { readCodeSlice } from "../mcp/index.js";
import { isNoneRunner, isReplayRunner } from "../agent/factory.js";
import { NoAgentError } from "../agent/none.js";
import { guideRevisionForSnapshot, toPromptSnapshot } from "../routes/prompts.js";import { buildBasePack, buildLadder, DEFAULT_HUNK_PASS_FANOUT_LIMIT } from "../context/index.js";
import { loadTemplatesDirSync, renderTemplate, resolvePromptsDir } from "../prompts/index.js";
import type { SessionManager } from "../sessions/manager.js";
import { baseKeyString } from "../sessions/manager.js";
import type { SettingsStore } from "../settings/index.js";
import { resolveEffectiveSettings } from "../settings/index.js";
import type { ModelCatalog } from "../settings/index.js";
import type { ReviewStore } from "../state/store.js";
import type { CommandRunner } from "../exec/index.js";
import { validateReply } from "../validate/index.js";
import { lookupForSnapshot } from "./lookup.js";
import { createSuggestedCommentInDraft } from "../comments/threads.js";
import { criticApply, isDefaultReaderCardId, readerApply, readerCardId, splitFinalizedBlocks } from "./apply.js";
import { withReplayMark } from "./replayMark.js";
import { buildRepairVariables, finalizeFresh, mergeRepairedDiagrams } from "./actions/diagram-finalize.js";
import type { ActionContext } from "./actions/common.js";
import { changeListVariable, ingestAgentTurn } from "./sharedctx-wire.js";
import type { SharedContextService } from "../sharedctx/service.js";
import type { RunInForkOptions, RunInForkResult, RunSmallOptions } from "./types.js";

export interface PipelineOptions {
  reviews: ReviewStore;
  jobs: JobQueue;
  sessions: SessionManager;
  runner: AgentRunner;
  mcp: McpRegistry;
  settings: SettingsStore;
  /** Model catalog for live role defaults (issue #88): the pipeline runs the same effective settings as GET /api/settings. Absent → stored settings stand. */
  models?: ModelCatalog | null;
  commands: CommandRunner;
  dataDir: string;
  promptsDir?: string;
  mcpBaseUrl?: string;
  fixturesDir?: string;
  /** M5 shared context (PRD §9.3–§9.5): change lists, contributions, growth. */
  sharedctx?: SharedContextService;
}

type Session = { id: string; provider: string; model: string };

async function collectStreaming(
  runner: AgentRunner,
  session: Session,
  prompt: string,
  signal: AbortSignal | undefined,
  onDelta: (delta: string) => void,
  onTool?: () => void,
): Promise<{ text: string; usage: TokenUsage }> {
  let text = "";
  let afterTool = false;
  const usage: TokenUsage = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
  for await (const ev of runner.prompt(session, prompt, signal)) {
    if (ev.type === "text") {
      // Text on either side of a tool call arrives with nothing between it
      // ("…my restatement.Only two files…"): make it a paragraph break.
      const delta = afterTool && text && !text.endsWith("\n\n") ? `\n\n${ev.delta}` : ev.delta;
      afterTool = false;
      text += delta;
      onDelta(delta);
    } else if (ev.type === "tool") {
      if (ev.status === "start") {
        afterTool = true;
        onTool?.();
      }
    } else if (ev.type === "usage") {
      usage.inputTokens += ev.inputTokens;
      usage.cachedReadTokens += ev.cachedReadTokens;
      usage.cachedWriteTokens += ev.cachedWriteTokens;
      usage.outputTokens += ev.outputTokens;
    } else if (ev.type === "error") {
      if (ev.retryable) throw new RetryableError(ev.message);
      throw new Error(ev.message);
    }
    if (signal?.aborted) throw new Error("aborted");
  }
  return { text, usage };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Tool-chatter frames, issue #51 — see throwIfDegradedTurn. Ordinary
 * words in a process-complaint shape ("I tried to look it up with gh",
 * "resolve returned no IDs"). They fail a job only conjoined with a
 * fact below. Tool names and the words MCP/gh on their own never fail a
 * job: a PR about MCP legitimately discusses them in prose.
 */
const DEGRADED_FRAME_RES = [
  /\bi\s+(could\s*not|couldn'?t|tried\s+to|attempted\s+to|was\s+unable\s+to|wasn'?t\s+able\s+to)\b[^.]{0,120}\b(look|cite|connect|access|confirm|verify|fetch|retrieve)\b/i,
  /command\s+was\s+refused|permission\s+(denied|refused)/i,
  /failed\s+to\s+connect/i,
  /resolve\s+returned\s+no\b/i,
];

/** Strip fenced and inline code: code may legitimately contain these words. */
function stripCodeForChatter(body: string): string {
  return body.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
}

/**
 * Plain-words note appended to a kept degraded answer (never the agent's
 * internal reason — that lives on the job for the Debug page).
 */
export const DEGRADED_ANSWER_NOTE = "Some references in this answer could not be linked to the code.";

/** Id for the appended degraded note (deduped, never anchored). */
export const DEGRADED_NOTE_BLOCK_ID = "b-degraded-note";

export type DegradedDisposition =
  | { kind: "ok" }
  | { kind: "fail-conn"; message: string }
  | { kind: "fail"; message: string }
  | { kind: "keep"; reason: string };

/**
 * Append the quiet degraded note to a kept answer's last card (once —
 * keyed by its stable block id). The note is plain words; the agent's
 * internal reason lives on the job for the Debug page.
 */
function attachDegradedNote(cards: { blocks: { id: string }[] }[]): void {
  const last = cards[cards.length - 1];
  if (!last) return;
  if (last.blocks.some((b) => b.id === DEGRADED_NOTE_BLOCK_ID || b.id.startsWith(`${DEGRADED_NOTE_BLOCK_ID}-`))) {
    return;
  }
  (last.blocks as unknown[]).push({
    type: "paragraph",
    id: DEGRADED_NOTE_BLOCK_ID,
    text: { standard: DEGRADED_ANSWER_NOTE },
    citations: [],
  });
}

/**
 * Codex MCP-refusal flake (docs/acp-runner.md quirk 6): the model answers
 * "I can't access that tool" without attempting an MCP call. Our sessions
 * must call MCP tools, so treat it as retryable (a fresh retry usually
 * attempts the tool). Only checked on MCP-capable turns (reader, forks,
 * update); small-model hunk jobs carry no MCP servers.
 */
const MCP_REFUSAL_RE = /can'?t access (that )?tool/i;
function throwIfMcpRefusal(text: string): void {
  if (MCP_REFUSAL_RE.test(text)) {
    throw new RetryableError("codex MCP refusal flake (no tool attempt); retrying");
  }
}

/**
 * Fence-tag language for a pinned path. No shared helper exists (pin
 * producers are the only excerpt source that derives it), so the map
 * lives with the single producer below.
 */
const EXTENSION_LANGUAGE: Record<string, string> = {
  py: "python",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "bash",
  bash: "bash",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  php: "php",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  css: "css",
  html: "html",
  htm: "html",
  xml: "xml",
  sql: "sql",
};

function languageForPath(relPath: string): string | undefined {
  const dot = relPath.lastIndexOf(".");
  if (dot < 0) return undefined;
  return EXTENSION_LANGUAGE[relPath.slice(dot + 1).toLowerCase()];
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

function citationsOf(block: Block): string[] {
  switch (block.type) {
    case "paragraph":
      return block.citations.map((c) => c.target);
    case "list":
      return [...block.citations.map((c) => c.target), ...block.items.flatMap((it) => it.citations.map((c) => c.target))];
    case "table":
    case "code":
    case "diagram":
    case "finding-link":
    case "follow-up":
      return (block as { citations: { target: string }[] }).citations.map((c) => c.target);
    case "comment-link":
      return [...block.citations.map((c) => c.target), block.diffRef];
    case "aside":
      return [...block.citations.map((c) => c.target), ...block.inner.flatMap(citationsOf)];
  }
}

export class Pipeline {
  private promptsDir: string;
  private mcpBaseUrl: string;
  /** #122: reviews with a base rebuild already warming (debounce). */
  private warmInFlight = new Set<string>();
  /**
   * Hunk-pass completions since the last fan-out, per review (issue
   * #107). Counting queue states (`maybeMarkStageDone`) races when jobs
   * finish together: every job sees its siblings still "running" — the
   * queue flips them to done only after each `run()` returns — so nobody
   * marks the stage done. Counting completions in the success path is
   * exact: each increment runs atomically between awaits.
   */
  private hunkPassCompleted = new Map<string, number>();

  constructor(private readonly opts: PipelineOptions) {
    this.promptsDir = opts.promptsDir ?? resolvePromptsDir() ?? "prompts";
    this.mcpBaseUrl = opts.mcpBaseUrl ?? "http://127.0.0.1:4517";
  }

  get runner(): AgentRunner {
    return this.opts.runner;
  }

  /** CommandRunner for D2 subprocesses (diagrams module). */
  get commands(): CommandRunner {
    return this.opts.commands;
  }

  get dataDir(): string {
    return this.opts.dataDir;
  }

  get fixturesDir(): string | undefined {
    return this.opts.fixturesDir;
  }

  /** M5 shared context: attach the service after construction (app.ts). */
  setSharedContext(sharedctx: SharedContextService): void {
    this.opts.sharedctx = sharedctx;
  }

  /**
   * Effective settings (issue #88): saved picks win, unsaved roles take
   * live defaults from the model catalog. Never throws (falls back to
   * stored); never writes.
   */
  private effectiveSettings() {
    return resolveEffectiveSettings({ settings: this.opts.settings, models: this.opts.models ?? null });
  }

  /** Deps for the shared-context wire module (PRD §9.3–§9.5). */
  private wireDeps(): {
    reviews: ReviewStore;
    sessions: SessionManager;
    settings: SettingsStore;
    promptsDir: string;
    sharedctx?: SharedContextService;
  } {
    return {
      reviews: this.opts.reviews,
      sessions: this.opts.sessions,
      settings: this.opts.settings,
      promptsDir: this.promptsDir,
      ...(this.opts.sharedctx ? { sharedctx: this.opts.sharedctx } : {}),
    };
  }

  /**
   * Post-success bookkeeping for one agent turn (contributions, seen marker,
   * base growth). Best-effort: never fails the job. Only call when the turn
   * succeeded — failed turns must not advance the marker.
   */
  private async ingestTurn(
    reviewId: string,
    turn: {
      sessionId: string;
      annotationId?: string;
      conversationKey?: string;
      cardId?: string;
      hunkHash?: string;
      data: ReplyData | null;
    },
  ): Promise<void> {
    if (!this.opts.sharedctx) return;
    try {
      const snapshot = this.opts.reviews.getSnapshot(reviewId);
      if (!snapshot) return;
      const lookup = this.lookupWithAliases(snapshot);
      await ingestAgentTurn(this.wireDeps(), reviewId, {
        sessionId: turn.sessionId,
        ...(turn.annotationId ? { annotationId: turn.annotationId } : {}),
        ...(turn.conversationKey ? { conversationKey: turn.conversationKey } : {}),
        ...(turn.cardId ? { cardId: turn.cardId } : {}),
        ...(turn.hunkHash ? { hunkHash: turn.hunkHash } : {}),
        data: turn.data,
        snapshot,
        lookup,
        appendToBase: (baseKey, batch) => this.opts.sessions.appendLogBatch(baseKey, batch),
      });
    } catch {
      // best-effort
    }
  }

  // -- reusable seam --------------------------------------------------

  async runInFork(o: RunInForkOptions): Promise<RunInForkResult> {
    const snapshot = this.opts.reviews.getSnapshot(o.reviewId);
    if (!snapshot) throw new Error(`unknown review ${o.reviewId}`);
    // Fail fast when the pipeline is disabled: the base build below would
    // throw this anyway, but only after a job id went out (#122 keeps the
    // enqueue ahead of the base — a doomed job must never be handed out).
    if (isNoneRunner(this.opts.runner)) throw new NoAgentError();
    const settings = await this.effectiveSettings();
    const provider = settings.main.provider;
    const model = settings.main.model;
    // #122: enqueue before awaiting the base, so the click gets its job id
    // at once. The base seq for the change list is read synchronously from
    // the current base (absent → 0, a safe under-approximation: the fork may
    // repeat entries, never miss them); the job ensures the base inside.
    const baseLogSeq =
      this.opts.sessions.baseInfo(
        baseKeyString({
          reviewId: o.reviewId,
          reviewVersion: `v${snapshot.version.n}`,
          guideRevision: guideRevisionForSnapshot(snapshot),
          provider,
          model,
        }),
      )?.logSeq ?? 0;
    const variables = changeListVariable(this.wireDeps(), o.reviewId, o.template, o.variables, {
      ...(o.conversationKey ? { conversationKey: o.conversationKey } : {}),
      ...(o.cardId ? { cardId: o.cardId } : {}),
      ...(o.hunkHash ? { hunkHash: o.hunkHash } : {}),
      baseLogSeq,
    });
    const template = this.render(o.template, variables);
    let prompt = withReplayMark(template, o.replay && isReplayRunner(this.opts.runner) ? o.replay : undefined);

    let resolveResult!: (r: RunInForkResult) => void;
    let rejectResult!: (e: Error) => void;
    const done = new Promise<RunInForkResult>((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });

    const enqueued = this.opts.jobs.enqueue({
      reviewId: o.reviewId,
      kind: o.kind,
      provider,
      model,
      priority: o.priority,
      ...(o.dedupeKey ? { dedupe: o.dedupeKey } : {}),
      ...(o.cardId ? { cardId: o.cardId } : {}),
      ...(o.annotationId ? { annotationId: o.annotationId } : {}),
      promptSnapshot: prompt,
      run: async (ctx) => {
        // Retryable errors retry inside the job (so the deferred settles
        // once); non-retryable errors reject and mark the job error.
        // A continued session stays across attempts — except the
        // connection retry, which forks fresh (see below).
        let continuedId = o.continueSessionId;
        for (let attempt = 0; ; attempt++) {
          try {
            ctx.setPromptSnapshot(prompt);
            // #122: the base builds here, inside the job — after the job id
            // went out. forkFor ensures the same base again (a live-cache hit).
            const base = await this.ensureBase(o.reviewId);
            void base;
            // Issue #136: later turns of a conversation card continue on
            // the card's session instead of forking again. All turns share
            // this path's streaming, citation check, repair turn, usage
            // and contribution handling.
            const forked = continuedId
              ? await this.continueOn(continuedId)
              : await this.forkAndTrack(o.reviewId, o.conversationKey !== undefined);
            ctx.setSessionId(forked.session.id);
            let buffer = "";
            // Per-attempt evidence: a retry must observe *its own* turn's
            // tool activity, not the previous attempt's.
            const mcpBefore = this.opts.mcp.activitySnapshot(o.reviewId);
            const { text, usage } = await collectStreaming(
              this.opts.runner,
              forked.session,
              prompt,
              o.signal ?? ctx.signal,
              (delta) => {
                ctx.reportText(delta);
                buffer += delta;
                if (o.onPartial) {
                  try {
                    const partials = parseCardsPartial(buffer);
                    if (partials.length > 0) void o.onPartial(partials);
                  } catch {
                    // ignore mid-stream parse errors
                  }
                }
              },
            );
            throwIfMcpRefusal(text);
            const first = this.parseAndValidate(o.reviewId, text, o.echoCandidates);
            // A degraded first reply fails fast — unless it still has a
            // usable body, which is kept with a quiet note (#51, weakened
            // by usable bodies). No repair turn can fix chatter about the
            // agent's own tooling, so a kept answer skips repair.
            let degradedReason: string | undefined;
            const firstDisp = this.degradedDisposition(
              o.reviewId,
              mcpBefore,
              first.data,
              first.body,
              first.cards.flatMap((c) => c.blocks).length,
            );
            if (firstDisp.kind === "fail-conn") throw new DegradedConnError(firstDisp.message);
            if (firstDisp.kind === "fail") throw new DegradedTurnError(firstDisp.message);
            if (firstDisp.kind === "keep") degradedReason = firstDisp.reason;
            let finalText = text;
            let finalCards = first.cards;
            let finalData = first.data;
            let finalValidation = first.validation;
            let repaired = false;
            if (first.validation.needsRepairTurn && degradedReason === undefined) {
              repaired = true;
              const anchorProblem =
                first.validation.anchor && !first.validation.anchor.ok
                  ? `\nAnchor problem: ${first.validation.anchor.reason}. Reply with the same content and a corrected anchor host (the host block's ID).\n`
                  : "";
              const repairPrompt =
                `Some citations in your previous reply could not be verified:\n` +
                first.validation.tokens
                  .filter((t) => t.status === "unverified")
                  .map((t) => `- ${t.target}: ${t.reason ?? "unknown"}`)
                  .join("\n") +
                anchorProblem +
                `\nReply with the same content and corrected citation tokens. End with the same trailing JSON block.`;
              const repair = await collectStreaming(this.opts.runner, forked.session, repairPrompt, o.signal ?? ctx.signal, (d) =>
                ctx.reportText(d),
              );
              usage.inputTokens += repair.usage.inputTokens;
              usage.cachedReadTokens += repair.usage.cachedReadTokens;
              usage.cachedWriteTokens += repair.usage.cachedWriteTokens;
              usage.outputTokens += repair.usage.outputTokens;
              throwIfMcpRefusal(repair.text);
              finalText = repair.text;
              const second = this.parseAndValidate(o.reviewId, repair.text, o.echoCandidates);
              finalCards = second.cards;
              finalData = second.data;
              finalValidation = second.validation;
              const secondDisp = this.degradedDisposition(
                o.reviewId,
                mcpBefore,
                second.data,
                second.body,
                second.cards.flatMap((c) => c.blocks).length,
              );
              if (secondDisp.kind === "fail-conn") throw new DegradedConnError(secondDisp.message);
              if (secondDisp.kind === "fail") throw new DegradedTurnError(secondDisp.message);
              if (secondDisp.kind === "keep" && degradedReason === undefined) degradedReason = secondDisp.reason;
            }
            if (degradedReason !== undefined) {
              attachDegradedNote(finalCards);
              ctx.setDegradedReason(degradedReason);
            }
            ctx.reportUsage(usage);
            await this.recordUsage(o.reviewId, usage);
            if (o.onPartial) {
              try {
                await o.onPartial(finalCards);
              } catch {
                // ignore
              }
            }
            // #122: the finished answer goes out before post-turn
            // bookkeeping. The job still awaits the bookkeeping below, so a
            // crash in between leaves it visibly interrupted (never silently
            // unbookkept), and the next job drains the chain in forkFor.
            resolveResult({
              job: this.opts.jobs.get(enqueued.id) ?? enqueued,
              text: finalText,
              cards: finalCards,
              data: finalData,
              validation: finalValidation,
              usage,
              viaFork: forked.viaFork,
              repaired,
            });
            await this.finishBookkeeping(o.reviewId, () =>
              this.ingestTurn(o.reviewId, {
                sessionId: forked.session.id,
                ...(o.annotationId ? { annotationId: o.annotationId } : {}),
                ...(o.conversationKey ? { conversationKey: o.conversationKey } : {}),
                ...(o.cardId ? { cardId: o.cardId } : {}),
                ...(o.hunkHash ? { hunkHash: o.hunkHash } : {}),
                data: finalData,
              }),
            );
            return;
          } catch (err) {
            // One retry on a fresh session when the turn observably hit a
            // dead review-MCP URL (#51: transient, e.g. slow-starting
            // server). A continued conversation falls back to a fresh fork
            // — retrying on the same dead session could never reconnect —
            // with the full first-turn prompt plus the stored transcript
            // (the short follow-up prompt assumes the live session's
            // history). A second failure, and any other degraded turn, is
            // terminal — unless the reply still has a usable body, which
            // the disposition above keeps.
            if (err instanceof DegradedConnError && attempt < 1) {
              continuedId = undefined;
              if (o.retryTemplate && o.retryVariables) {
                const retryVars = changeListVariable(this.wireDeps(), o.reviewId, o.retryTemplate, o.retryVariables, {
                  ...(o.conversationKey ? { conversationKey: o.conversationKey } : {}),
                  ...(o.cardId ? { cardId: o.cardId } : {}),
                  ...(o.hunkHash ? { hunkHash: o.hunkHash } : {}),
                  baseLogSeq,
                });
                prompt = withReplayMark(
                  this.render(o.retryTemplate, retryVars),
                  o.replay && isReplayRunner(this.opts.runner) ? o.replay : undefined,
                );
              }
              continue;
            }
            if (err instanceof RetryableError && attempt < 3) {
              await sleepMs(50 * (attempt + 1));
              continue;
            }
            rejectResult(err as Error);
            throw err;
          }
        }
      },
    });
    // M4: hand the enqueued job to the action handler (jobId + cancel).
    try {
      o.onJob?.(enqueued);
    } catch {
      // ignore
    }
    void enqueued;
    return done;
  }

  async runSmall(o: RunSmallOptions): Promise<RunInForkResult> {
    const settings = await this.effectiveSettings();
    const template = this.render(o.template, o.variables);
    const prompt = withReplayMark(template, o.replay && isReplayRunner(this.opts.runner) ? o.replay : undefined);
    const provider = settings.small.provider;
    const model = settings.small.model;

    let resolveResult!: (r: RunInForkResult) => void;
    let rejectResult!: (e: Error) => void;
    const done = new Promise<RunInForkResult>((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });

    const enqueued = this.opts.jobs.enqueue({
      reviewId: o.reviewId,
      kind: o.kind,
      provider,
      model,
      priority: o.priority,
      ...(o.dedupeKey ? { dedupe: o.dedupeKey } : {}),
      ...(o.cardId ? { cardId: o.cardId } : {}),
      ...(o.annotationId ? { annotationId: o.annotationId } : {}),
      promptSnapshot: prompt,
      run: async (ctx) => {
        for (let attempt = 0; ; attempt++) {
          try {
            ctx.setPromptSnapshot(prompt);
            const session = await this.opts.runner.start({
              provider,
              model,
              cwd: this.worktreeOf(o.reviewId),
              systemPrompt: "",
              mcpServers: [],
            });
            ctx.setSessionId(session.id);
            try {
              const { text, usage } = await collectStreaming(this.opts.runner, session, prompt, o.signal ?? ctx.signal, (d) =>
                ctx.reportText(d),
              );
              const first = this.parseAndValidate(o.reviewId, text);
              let finalText = text;
              let finalCards = first.cards;
              let finalData = first.data;
              let finalValidation = first.validation;
              let repaired = false;
              if (first.validation.needsRepairTurn) {
                repaired = true;
                const repairPrompt =
                  `Some citations could not be verified:\n` +
                  first.validation.tokens
                    .filter((t) => t.status === "unverified")
                    .map((t) => `- ${t.target}: ${t.reason ?? "unknown"}`)
                    .join("\n") +
                  `\nReply with the same one-line summary and corrected citations. End with the same trailing JSON block.`;
                const repair = await collectStreaming(this.opts.runner, session, repairPrompt, o.signal ?? ctx.signal, (d) =>
                  ctx.reportText(d),
                );
                usage.inputTokens += repair.usage.inputTokens;
                usage.cachedReadTokens += repair.usage.cachedReadTokens;
                usage.cachedWriteTokens += repair.usage.cachedWriteTokens;
                usage.outputTokens += repair.usage.outputTokens;
                finalText = repair.text;
                const second = this.parseAndValidate(o.reviewId, repair.text);
                finalCards = second.cards;
                finalData = second.data;
                finalValidation = second.validation;
              }
              ctx.reportUsage(usage);
              await this.recordUsage(o.reviewId, usage);
              resolveResult({
                job: this.opts.jobs.get(enqueued.id) ?? enqueued,
                text: finalText,
                cards: finalCards,
                data: finalData,
                validation: finalValidation,
                usage,
                viaFork: false,
                repaired,
              });
            } finally {
              try {
                await this.opts.runner.close(session);
              } catch {
                // ignore
              }
            }
            return;
          } catch (err) {
            if (err instanceof RetryableError && attempt < 3) {
              await sleepMs(50 * (attempt + 1));
              continue;
            }
            rejectResult(err as Error);
            throw err;
          }
        }
      },
    });
    // M4: hand the enqueued job to the action handler (jobId + cancel).
    try {
      o.onJob?.(enqueued);
    } catch {
      // ignore
    }
    void enqueued;
    return done;
  }

  // -- pipeline stages ------------------------------------------------

  /**
   * M5 shared context (PRD §9.5): merge contributions on a base rebuild via
   * the small model (`consolidate` template). Returns the model's verdict;
   * the caller applies it with `applyConsolidation`. A small-model job, so
   * it carries only the contribution list — never the review, never the log.
   */
  async runConsolidateTask(
    reviewId: string,
    contributionsText: string,
  ): Promise<{ kept: { id: string }[]; dropped: { id: string; why: string }[] }> {
    const res = await this.runSmall({
      reviewId,
      kind: "consolidate",
      template: "consolidate",
      variables: { contributions: contributionsText },
      priority: JOB_PRIORITY.background,
    });
    const data = (res.data ?? {}) as Record<string, unknown>;
    const kept = Array.isArray(data["kept"])
      ? (data["kept"] as { id?: unknown }[])
          .filter((k): k is { id: string } => typeof k?.id === "string")
          .map((k) => ({ id: k.id }))
      : [];
    const dropped = Array.isArray(data["dropped"])
      ? (data["dropped"] as { id?: unknown; why?: unknown }[])
          .filter((d): d is { id: string; why: string } => typeof d?.id === "string")
          .map((d) => ({ id: d.id, why: typeof d.why === "string" ? d.why : "dropped by consolidation" }))
      : [];
    return { kept, dropped };
  }

  async startReview(reviewId: string): Promise<void> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) throw new Error(`unknown review ${reviewId}`);
    // `UNVIBE_AGENT=none`: the pipeline is disabled. Enqueue nothing, so
    // the review stays at its ingested snapshot and no background job
    // mutates it (comments/diff/versions specs rely on this).
    if (isNoneRunner(this.opts.runner)) return;
    this.ensurePipelineField(reviewId);
    this.setStage(reviewId, "reader", "pending");
    this.setStage(reviewId, "base", "pending");
    this.setStage(reviewId, "critic", "pending");
    this.setStage(reviewId, "concepts", "pending");
    this.setStage(reviewId, "hunk-pass", "pending");
    await this.enqueueReader(reviewId);
    // #123: the hunk pass needs only the diff, so it starts at ingest
    // instead of waiting for the reader. Small-model jobs run in their own
    // queue bucket, never behind the critics. The CITED-BY-GUIDE hint is
    // absent this early (no guide yet); `unhideCitedHunks` repairs hides
    // that the guide later contradicts.
    await this.enqueueHunkPass(reviewId);
  }

  async resumeReview(reviewId: string): Promise<{ jobIds: string[]; pendingStages: string[] }> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) throw new Error(`unknown review ${reviewId}`);
    // `UNVIBE_AGENT=none`: nothing to resume; report the pending stages.
    if (isNoneRunner(this.opts.runner)) {
      const stages = this.stageStates(reviewId);
      const pendingStages = Object.entries(stages)
        .filter(([, v]) => v !== "done")
        .map(([k]) => k);
      return { jobIds: [], pendingStages };
    }
    this.ensurePipelineField(reviewId);
    const stages = this.stageStates(reviewId);
    const jobIds: string[] = [];
    if (stages.reader !== "done") {
      jobIds.push((await this.enqueueReader(reviewId)).id);
    } else {
      if (stages.base !== "done") jobIds.push(...(await this.enqueueAfterReader(reviewId)).map((j) => j.id));
      else {
        if (stages.critic !== "done") jobIds.push(...(await this.enqueueCritic(reviewId)).map((j) => j.id));
        if (stages.concepts !== "done") jobIds.push(...(await this.enqueueConcepts(reviewId)).map((j) => j.id));
        if (stages["hunk-pass"] !== "done") jobIds.push(...(await this.enqueueHunkPass(reviewId)).map((j) => j.id));
        // Issue #169: the plotline assign step is not a stage; resume it
        // like the demo fill below (no-op unless the reader named
        // plotlines on a degraded rung with hunks still unassigned).
        jobIds.push(...(await this.maybeEnqueuePlotlineAssign(reviewId)).map((j) => j.id));
        // Demo auto-fill is part of enqueueAfterReader, not a stage: a
        // restart after the base finished would otherwise leave pending
        // placeholders unfilled. No-op when nothing is pending.
        jobIds.push(...(await this.enqueueDemoFill(reviewId)).map((j) => j.id));
      }
    }
    const after = this.stageStates(reviewId);
    const pendingStages = Object.entries(after)
      .filter(([, v]) => v !== "done")
      .map(([k]) => k);
    return { jobIds, pendingStages };
  }

  async ensureConceptPage(reviewId: string, slug: string): Promise<Job> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) throw new Error(`unknown review ${reviewId}`);
    const existing = snapshot.pages.find((p) => p.id === `c-${slug}`);
    const effective = await this.effectiveSettings();
    if (existing && existing.cards.length > 0 && existing.cards[0].blocks.length > 1) {
      return this.opts.jobs.enqueue({
        reviewId,
        kind: "concept",
        provider: effective.main.provider,
        model: effective.main.model,
        priority: JOB_PRIORITY.userRequested,
        run: async () => {},
      });
    }
    const settings = effective;
    const prompt = withReplayMark(
      this.render("concept_page", {
        concept: `${slug} — ${existing?.title ?? slug}`,
        mentions: this.mentionsOf(snapshot, slug),
      }),
      isReplayRunner(this.opts.runner) ? { kind: "concept-page", key: slug } : undefined,
    );
    const base = await this.ensureBase(reviewId);
    void base;
    const job = this.opts.jobs.enqueue({
      reviewId,
      kind: "concept",
      provider: settings.main.provider,
      model: settings.main.model,
      priority: JOB_PRIORITY.userRequested,
      dedupe: { anchor: `concept:${slug}`, requestKind: "concept-page", baseVersion: `v${snapshot.version.n}` },
      cardId: `cc-${slug}`,
      run: async (ctx) => {
        ctx.setPromptSnapshot(prompt);
        const forked = await this.forkFor(reviewId);
        ctx.setSessionId(forked.session.id);
        const { text, usage } = await collectStreaming(this.opts.runner, forked.session, prompt, ctx.signal, (d) =>
          ctx.reportText(d),
        );
        ctx.reportUsage(usage);
        throwIfMcpRefusal(text);
        await this.recordUsage(reviewId, usage);
        // Issue #50: match the page title (an echo of the concept name).
        const { cards, data, validation } = this.parseAndValidate(reviewId, text, [
          ...(existing?.title ? [existing.title] : []),
          slug,
        ]);
        const title = (data?.["title"] as string | undefined) ?? existing?.title ?? slug;
        const blocks = this.withValidation(
          reviewId,
          cards.flatMap((c) => c.blocks),
          validation,
        );
        // Inline diagrams go through finalize + one repair turn on the
        // fill's own session (#130), so stored blocks carry a real status.
        const stored = await this.finalizeInlineBlocks(
          reviewId,
          forked.session,
          ctx.signal,
          `Concept page: ${slug}`,
          "standard",
          blocks,
          (u) => ctx.reportUsage(u),
        );
        await this.opts.reviews.mutate(reviewId, (draft) => {
          let page = draft.pages.find((p) => p.id === `c-${slug}`);
          if (!page) {
            page = { id: `c-${slug}`, kind: "concept", title, saved: true, parent: "root", cards: [] };
            draft.pages.push(page);
          }
          page.title = title;
          page.cards = [
            {
              id: `cc-${slug}`,
              pageId: `c-${slug}`,
              title: null,
              level: "standard",
              collapsed: false,
              revision: (page.cards[0]?.revision ?? 0) + 1,
              blocks: stored,
              undoStack: [],
            },
          ];
        });
        await this.appendLog(reviewId, "new-card", { summary: `concept page ${slug}` }, { scope: "global" });
        // #122: the page changed the guide — rebuild the base ahead.
        this.warmBase(reviewId);
      },
    });
    return job;
  }

  async summarizeHunk(reviewId: string, contentHash: string): Promise<Job | { reused: true; summary: string }> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) throw new Error(`unknown review ${reviewId}`);
    const found = snapshot.files.flatMap((f) => f.hunks.map((h) => ({ file: f, hunk: h }))).find(
      (x) => x.hunk.contentHash === contentHash,
    );
    if (!found) throw new Error(`unknown hunk ${contentHash}`);
    // PRD §12 reuse (#10): a hunk that already carries a stored summary for
    // the same content hash returns it with no agent call. Hunk state is
    // keyed by content hash so it survives rebases (PRD §8); a deleted
    // summary (PATCH null) or changed content (new hash) is legitimately a
    // new request.
    const stored = snapshot.hunkStates.find((s) => s.contentHash === contentHash)?.summary;
    if (stored) return { reused: true, summary: stored };
    const settings = await this.effectiveSettings();
    const hunkText = this.formatHunkForPrompt(snapshot, found.file.fileKey, found.hunk.contentHash);
    const prompt = withReplayMark(
      this.render("hunk_pass", { hunk: hunkText, path: found.file.path }),
      isReplayRunner(this.opts.runner)
        ? { kind: "hunk", key: this.replayKeyForHunk(snapshot, found.file.fileKey, contentHash) ?? undefined }
        : undefined,
    );
    return this.opts.jobs.enqueue({
      reviewId,
      kind: "summarize",
      provider: settings.small.provider,
      model: settings.small.model,
      priority: JOB_PRIORITY.userRequested,
      dedupe: { anchor: `hunk:${contentHash}`, requestKind: "summarize", baseVersion: `v${snapshot.version.n}` },
      run: async (ctx) => {
        ctx.setPromptSnapshot(prompt);
        const session = await this.opts.runner.start({
          provider: settings.small.provider,
          model: settings.small.model,
          cwd: this.worktreeOf(reviewId),
          systemPrompt: "",
          mcpServers: [],
        });
        ctx.setSessionId(session.id);
        try {
          const { text, usage } = await collectStreaming(this.opts.runner, session, prompt, ctx.signal, (d) =>
            ctx.reportText(d),
          );
          ctx.reportUsage(usage);
          await this.recordUsage(reviewId, usage);
          const { data } = this.parseAndValidate(reviewId, text);
          await this.applyHunkSummary(reviewId, contentHash, parseHunkReply(text, data));
        } finally {
          try {
            await this.opts.runner.close(session);
          } catch {
            // ignore
          }
        }
      },
    });
  }

  /**
   * Store one hunk-pass result (#99), shared by `summarizeHunk` and the
   * hunk-pass stage (the two copied parse blocks). A missing summary stores
   * nothing, so the hunk shows the Summarize action again instead of
   * garbage. Guide-cited and one-line hunks are never hidden.
   *
   * Issue #169: the score is stored alongside, resolved against the
   * deterministic rules (`resolveHunkScore`): an unusable value reads as
   * routine, and a one-line change is never mechanical. Hiding still
   * follows `hiddenReason` alone — the score never hides or unhides.
   */
  private async applyHunkSummary(reviewId: string, contentHash: string, result: HunkReplyResult): Promise<void> {
    let hiddenReason = result.hiddenReason;
    const live = this.opts.reviews.getSnapshot(reviewId);
    const isOneLine = live ? this.isOneLineChange(live, contentHash) : false;
    if (live && (this.isCitedByGuide(reviewId, contentHash) || isOneLine)) {
      hiddenReason = null;
    }
    const score = resolveHunkScore(result.score, { isOneLine });
    await this.opts.reviews.mutate(reviewId, (draft) => {
      let state = draft.hunkStates.find((s) => s.contentHash === contentHash);
      if (!state) {
        state = { contentHash, folded: false, reviewed: false };
        draft.hunkStates.push(state);
      }
      if (result.summary !== undefined) {
        state.summary = result.summary;
      }
      state.score = score;
      const fileHunk = draft.files.flatMap((f) => f.hunks).find((h) => h.contentHash === contentHash);
      if (fileHunk) {
        if (hiddenReason) fileHunk.hiddenReason = hiddenReason;
        else delete fileHunk.hiddenReason;
      }
    });
  }

  /**
   * #123: a hunk hidden as uninteresting before the guide existed must not
   * stay hidden once the guide cites it. Runs when the reader lands; hunks
   * applied later check the live guide in `applyHunkSummary`, so either
   * order is safe (both are single atomic mutates on live state).
   */
  private async unhideCitedHunks(reviewId: string): Promise<void> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return;
    const cited = snapshot.files
      .flatMap((f) => f.hunks)
      .filter((h) => h.hiddenReason && this.isCitedByGuide(reviewId, h.contentHash))
      .map((h) => h.contentHash);
    if (cited.length === 0) return;
    const wanted = new Set(cited);
    await this.opts.reviews.mutate(reviewId, (draft) => {
      for (const h of draft.files.flatMap((f) => f.hunks)) {
        if (wanted.has(h.contentHash)) delete h.hiddenReason;
      }
    });
  }

  // -- internals ------------------------------------------------------

  private render(template: string, variables: Record<string, unknown>): string {
    const lib = loadTemplatesDirSync(this.promptsDir);
    const tpl = lib.get(template);
    if (!tpl) throw new Error(`unknown prompt template ${template}`);
    return renderTemplate(tpl, variables);
  }

  private worktreeOf(reviewId: string): string {
    return path.join(this.opts.dataDir, "worktrees", reviewId);
  }

  private parseAndValidate(
    reviewId: string,
    text: string,
    echoCandidates?: string[],
  ): { cards: ParsedCard[]; data: ReplyData | null; validation: ReturnType<typeof validateReply>; body: string } {
    const split = splitReply(text);
    // Malformed / non-object trailers are job-visible errors (reply-format
    // §10); a missing block is fine (many on-demand replies carry none).
    if (!split.ok && (split.error.kind === "malformed" || split.error.kind === "not-object")) {
      throw new Error(`the agent's reply was not in the expected format (${split.error.kind}: ${split.error.message})`);
    }
    const body = split.body;
    // Issue #50: the echo strip runs here, before validation, so a dropped
    // echo line's citations never enter the report (an echo line carries
    // none — lines with citations are kept).
    const cards =
      echoCandidates === undefined ? parseCards(body) : parseCards(body, { echoCandidates });
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) throw new Error(`unknown review ${reviewId}`);
    const lookup = this.lookupWithAliases(snapshot);
    const blocks = cards.flatMap((c) => c.blocks);
    const anchor =
      split.ok && typeof split.data === "object" && split.data !== null
        ? (split.data as ReplyData).anchor
        : undefined;
    const validation = validateReply(blocks, lookup, {
      ...(anchor?.quote && anchor?.host ? { anchor: { quote: anchor.quote, host: anchor.host } } : {}),
    });
    return { cards, data: split.ok ? (split.data as ReplyData) : null, validation, body };
  }

  /** Alias-aware lookup for diagram cite validation (demo fixture keys). */
  lookupForDiagrams(reviewId: string): ReturnType<typeof lookupForSnapshot> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) throw new Error(`unknown review ${reviewId}`);
    return this.lookupWithAliases(snapshot);
  }

  /**
 * Decide what a degraded signal means (#51, weakened by usable bodies).
 * Facts only, never vocabulary alone:
 * - the trailing `degraded` field is present: the agent says what the
 *   reply is weaker for. A usable body (it parses and has at least one
 *   block) is kept with the quiet note above and the raw reason on the
 *   job; only an empty answer fails the turn;
 * - the body matches a process-complaint frame AND the turn ran without
 *   the review MCP server (no new connection or call) or observably hit
 *   a dead review-MCP URL → fail as before: without tools behind it the
 *   reply is weakened. A connection-error failure throws
 *   DegradedConnError, which runInFork retries once on a fresh session;
 *   anything else here is terminal (a retry would likely reproduce it at
 *   full token cost).
 * The fail messages land in the job error, shown on the Debug page.
 */
private degradedDisposition(
  reviewId: string,
  before: { connected: number; toolCalls: number; unknownHits: number },
  data: ReplyData | null,
  body: string,
  blockCount: number,
): DegradedDisposition {
  const field = data?.degraded;
  if (typeof field === "string" && field.trim() !== "") {
    const reason = field.trim().slice(0, 300);
    if (blockCount > 0) return { kind: "keep", reason };
    return { kind: "fail", message: `agent reported a degraded turn: ${reason}` };
  }
  const after = this.opts.mcp.activitySnapshot(reviewId);
  const noActivity = after.toolCalls <= before.toolCalls && after.connected <= before.connected;
  const connError = after.unknownHits > before.unknownHits;
  if (!noActivity && !connError) return { kind: "ok" };
  const stripped = stripCodeForChatter(body);
  if (!DEGRADED_FRAME_RES.some((re) => re.test(stripped))) return { kind: "ok" };
  if (connError) {
    return {
      kind: "fail-conn",
      message: `agent reply reports what it could not look up; a review-MCP call failed this turn`,
    };
  }
  return {
    kind: "fail",
    message: `agent reply reports what it could not look up instead of answering`,
  };
}

/**
 * Reader-compat wrapper: the reader keeps #51's terminal behaviour —
 * a degraded reader turn fails its job instead of storing guide cards.
 */
private throwIfDegradedTurn(
  reviewId: string,
  before: { connected: number; toolCalls: number; unknownHits: number },
  data: ReplyData | null,
  body: string,
  blockCount: number,
): void {
  const disp = this.degradedDisposition(reviewId, before, data, body, blockCount);
  if (disp.kind === "ok") return;
  if (disp.kind === "fail-conn") throw new DegradedConnError(disp.message);
  if (disp.kind === "fail") throw new DegradedTurnError(disp.message);
  throw new DegradedTurnError(`agent reported a degraded turn: ${disp.reason}`);
}

  /**
   * ActionContext for diagram finalize/repair from fills that run inside
   * the pipeline itself (go-deeper, concept pages). finalizeFresh takes
   * an ActionContext; the pipeline owns every field it needs.
   */
  private actionContextFor(reviewId: string): ActionContext {
    return {
      pipeline: this,
      jobs: this.opts.jobs,
      reviews: this.opts.reviews,
      reviewId,
      ...(this.opts.sharedctx ? { sharedctx: this.opts.sharedctx } : {}),
      ...(this.opts.fixturesDir ? { fixturesDir: this.opts.fixturesDir } : {}),
      ...(this.promptsDir ? { promptsDir: this.promptsDir } : {}),
    };
  }

  /**
   * Finalize inline diagrams for a fill that already holds its blocks
   * (#130, #145): pre-check + render, plus exactly one repair turn on the
   * fill's own session when needed. A failed repair keeps the
   * error-status blocks; the prose is unaffected. One place decides "this
   * block is a diagram that needs finalizing", used by every job kind:
   * pipeline fills call this directly; second opinions call it through
   * their deps' pipeline. Never touches the shared log (no ingestTurn),
   * so second-opinion isolation holds.
   */
  async finalizeInlineBlocks(
    reviewId: string,
    session: Session,
    signal: AbortSignal | undefined,
    card: string,
    level: string,
    blocks: Block[],
    onUsage?: (u: TokenUsage) => void,
  ): Promise<Block[]> {
    const first = await finalizeFresh(this.actionContextFor(reviewId), blocks);
    if (!first.needsRepair) return first.blocks;
    return this.repairDiagramsInline(reviewId, session, signal, card, level, first, onUsage);
  }

  /**
   * One inline diagram-repair turn on an already-forked session (#130).
   * Fills that run inside a job (go-deeper, concept pages) cannot enqueue
   * a nested repair job through runInFork: with every per-provider slot
   * held by fills awaiting repair, the repairs would never start. So the
   * turn runs on the fill's own session with the same prompt shape —
   * exactly one turn, no loop. Content failures keep the error-status
   * blocks; aborts and transient (retryable) errors propagate so the
   * fill's job can cancel or retry whole.
   */
  private async repairDiagramsInline(
    reviewId: string,
    session: Session,
    signal: AbortSignal | undefined,
    card: string,
    level: string,
    first: { blocks: Block[]; messages: string[] },
    onUsage?: (u: TokenUsage) => void,
  ): Promise<Block[]> {
    const actx = this.actionContextFor(reviewId);
    try {
      const variables = buildRepairVariables(card, level, first.messages, first.blocks);
      const { text, usage } = await collectStreaming(
        this.opts.runner,
        session,
        this.render("diagram", variables),
        signal,
        () => {},
      );
      onUsage?.(usage);
      await this.recordUsage(reviewId, usage);
      throwIfMcpRefusal(text);
      const second = this.parseAndValidate(reviewId, text);
      const merged = mergeRepairedDiagrams(first.blocks, second.cards.flatMap((c) => c.blocks));
      return (await finalizeFresh(actx, merged)).blocks;
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof RetryableError) throw err;
      return first.blocks;
    }
  }

  private lookupWithAliases(snapshot: ReviewSnapshot): ReturnType<typeof lookupForSnapshot> {
    const aliases = aliasesForReview(snapshot, this.opts.fixturesDir);
    if (Object.keys(aliases).length === 0) return lookupForSnapshot(snapshot);
    const base = lookupForSnapshot(snapshot);
    const inner = base.resolveFileKey.bind(base);
    return {
      ...base,
      resolveFileKey: (key: string) => inner(key) ?? (aliases[key] ? inner(aliases[key]) : null),
    };
  }

  private withValidation(
    reviewId: string,
    blocks: Block[],
    validation: ReturnType<typeof validateReply>,
  ): Block[] {
    // Stored targets are canonical (real file keys): repaired tokens resolve
    // to their fix, alias-form tokens (`diff:conn:…`) resolve through the
    // lookup, and only truly unknown targets keep their raw form flagged.
    // The web needs no alias table.
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    const resolve = snapshot
      ? this.lookupWithAliases(snapshot).resolveFileKey.bind(this.lookupWithAliases(snapshot))
      : () => null;
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
          return { ...b, inner: this.withValidation(reviewId, b.inner, validation), citations: mark(b.citations) };
      }
    });
  }

  private async ensureBase(reviewId: string): Promise<{ sessionId: string; key: string }> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) throw new Error(`unknown review ${reviewId}`);
    const settings = await this.effectiveSettings();
    const promptSnap = toPromptSnapshot(snapshot, { model: settings.main.model });
    const lib = loadTemplatesDirSync(this.promptsDir);
    const instructionsTpl = lib.get("instructions");
    if (!instructionsTpl) throw new Error("missing instructions template");
    const instructions = renderTemplate(instructionsTpl, {});
    const pack = buildBasePack(promptSnap, instructions, { inlineBudgetTokens: settings.inlineBudgetTokens });
    // The base pack instructs the agent to answer "ready" (SessionManager
    // waits for it). buildBasePack's user is L1+L1b+L2; prefix the ready
    // instruction so fakes and real models alike acknowledge.
    const packText = `Read the base context below and reply with exactly \`ready\` and nothing else.\n\n${pack.user}`;
    const key = {
      reviewId,
      reviewVersion: `v${snapshot.version.n}`,
      guideRevision: guideRevisionForSnapshot(snapshot),
      provider: settings.main.provider,
      model: settings.main.model,
    };
    const mcp = this.opts.mcp.issueSession(reviewId, `base-${reviewId}`, "session");
    const mcpServers = [{ name: "unvibe", url: `${this.mcpBaseUrl}${mcp.path}` }];
    const handle = await this.opts.sessions.getBase({
      key,
      cwd: this.worktreeOf(reviewId),
      systemPrompt: instructions,
      mcpServers,
      pack: packText,
    });
    if (!handle.fresh) {
      // Warm base: the build params (including this call's MCP URL) were
      // ignored, so the just-issued secret was never handed to any session.
      // Revoke it immediately instead of leaking one secret per call.
      this.opts.mcp.revokeSession(mcp.secret);
    }
    if (handle.fresh) {
      try {
        this.opts.sharedctx?.noteBaseBuilt(reviewId, handle.key, pack.tokens);
      } catch {
        // observability is best-effort
      }
    }
    this.setStage(reviewId, "base", "done");
    return { sessionId: handle.session.id, key: handle.key };
  }

  /**
   * #122: rebuild the base in the background when the guide changed, so it
   * is ready before the next click. Fire-and-forget (never fails the
   * caller); at most one warm per review at a time, and `getBase` shares
   * in-flight builds, so each guide state builds at most once. A warm for a
   * guide state nobody acts on costs one base turn — the same turn the next
   * click would have paid.
   */
  private warmBase(reviewId: string): void {
    if (this.warmInFlight.has(reviewId)) return;
    this.warmInFlight.add(reviewId);
    void this.ensureBase(reviewId)
      .catch(() => {})
      .finally(() => {
        this.warmInFlight.delete(reviewId);
      });
  }

  /** #122: tails of per-review post-turn bookkeeping chains (never reject). */
  private bookkeepingTails = new Map<string, Promise<void>>();

  /**
   * #122: wait for the review's pending post-turn bookkeeping, so the next
   * job never forks (or continues) from a stale log. Resolves at once when
   * nothing is pending.
   */
  async drainBookkeeping(reviewId: string): Promise<void> {
    await (this.bookkeepingTails.get(reviewId) ?? Promise.resolve());
  }

  /**
   * #122: run post-turn bookkeeping serialized after the review's pending
   * bookkeeping. Callers resolve their answer first and await this before
   * their job settles. Never rejects (`ingestTurn` is best-effort).
   */
  async finishBookkeeping(reviewId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.bookkeepingTails.get(reviewId) ?? Promise.resolve();
    const cur = prev.then(task).then(
      () => undefined,
      () => undefined,
    );
    this.bookkeepingTails.set(reviewId, cur);
    try {
      await cur;
    } finally {
      if (this.bookkeepingTails.get(reviewId) === cur) this.bookkeepingTails.delete(reviewId);
    }
  }

  /**
   * Issue #136: continue a later turn on an existing conversation
   * session. The session is ensured (reopened when idle-closed); a
   * rebuild between the caller's probe and this job proceeds on the fresh
   * session — the retry path then forks with the stored transcript.
   */
  private async continueOn(sessionId: string): Promise<{ session: Session; viaFork: boolean }> {
    const { session } = await this.opts.sessions.ensureConversation(sessionId);
    return { session, viaFork: true };
  }

  /**
   * Issue #136: fork for a turn and register the fork when it backs a
   * persistent conversation (`conversationKey`, e.g. a card id).
   * Registration is what makes the session tracked, persisted,
   * idle-closed and reopenable (#143); one-shot forks stay untracked.
   */
  private async forkAndTrack(reviewId: string, track: boolean): Promise<{ session: Session; viaFork: boolean }> {
    const forked = await this.forkFor(reviewId);
    if (track) {
      const snapshot = this.opts.reviews.getSnapshot(reviewId);
      const settings = await this.effectiveSettings();
      if (snapshot) {
        this.opts.sessions.registerConversation(
          forked.session,
          {
            reviewId,
            reviewVersion: `v${snapshot.version.n}`,
            guideRevision: guideRevisionForSnapshot(snapshot),
            provider: settings.main.provider,
            model: settings.main.model,
          },
          forked.viaFork,
        );
      }
    }
    return forked;
  }

  private async forkFor(reviewId: string): Promise<{ session: Session; viaFork: boolean }> {
    // #122: never fork from a stale log — wait for the previous turn's
    // bookkeeping (base growth) to land first.
    await this.drainBookkeeping(reviewId);
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) throw new Error(`unknown review ${reviewId}`);
    const settings = await this.effectiveSettings();
    const promptSnap = toPromptSnapshot(snapshot, { model: settings.main.model });
    const lib = loadTemplatesDirSync(this.promptsDir);
    const instructionsTpl = lib.get("instructions");
    if (!instructionsTpl) throw new Error("missing instructions template");
    const instructions = renderTemplate(instructionsTpl, {});
    const pack = buildBasePack(promptSnap, instructions, { inlineBudgetTokens: settings.inlineBudgetTokens });
    const packText = `Read the base context below and reply with exactly \`ready\` and nothing else.\n\n${pack.user}`;
    const base = await this.opts.sessions.getBase({
      key: {
        reviewId,
        reviewVersion: `v${snapshot.version.n}`,
        guideRevision: guideRevisionForSnapshot(snapshot),
        provider: settings.main.provider,
        model: settings.main.model,
      },
      cwd: this.worktreeOf(reviewId),
      systemPrompt: instructions,
      mcpServers: [{ name: "unvibe", url: `${this.mcpBaseUrl}/api/mcp/fallback` }],
      pack: packText,
    });
    const runner = this.opts.runner;
    if (typeof runner.fork === "function") {
      try {
        const session = await runner.fork(base.session);
        return { session, viaFork: true };
      } catch {
        // fall through
      }
    }
    const mcp = this.opts.mcp.issueSession(reviewId, `fork-${Date.now()}`, "session");
    const session = await runner.start({
      provider: settings.main.provider,
      model: settings.main.model,
      cwd: this.worktreeOf(reviewId),
      systemPrompt: instructions,
      mcpServers: [{ name: "unvibe", url: `${this.mcpBaseUrl}${mcp.path}` }],
    });
    for await (const ev of runner.prompt(session, packText)) {
      if (ev.type === "error" && ev.retryable) throw new RetryableError(ev.message);
      if (ev.type === "error") throw new Error(ev.message);
    }
    return { session, viaFork: false };
  }

  // -- reader ---------------------------------------------------------

  private async enqueueReader(reviewId: string): Promise<Job> {
    const settings = await this.effectiveSettings();
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) throw new Error(`unknown review ${reviewId}`);
    const promptSnap = toPromptSnapshot(snapshot, { model: settings.main.model });
    // One ladder call for both halves (issue #107): source + diff come
    // from the same rung, so the reader prompt stays under the hard cap.
    const ladder = buildLadder(promptSnap, { inlineBudgetTokens: settings.inlineBudgetTokens });
    const source = ladder.source;
    const diff = ladder.diff;
    const lib = loadTemplatesDirSync(this.promptsDir);
    const instructions = renderTemplate(lib.get("instructions")!, {});
    let prompt = renderTemplate(lib.get("reader")!, {
      source,
      diff_inline: diff.text,
      repo_path: this.worktreeOf(reviewId),
    });
    if (isReplayRunner(this.opts.runner)) prompt = withReplayMark(prompt, { kind: "reader" });
    this.setStage(reviewId, "reader", "running");
    return this.opts.jobs.enqueue({
      reviewId,
      kind: "reader",
      provider: settings.main.provider,
      model: settings.main.model,
      priority: JOB_PRIORITY.visible,
      dedupe: { anchor: "guide", requestKind: "reader", baseVersion: `v${snapshot.version.n}` },
      run: async (ctx) => {
        ctx.setPromptSnapshot(prompt);
        // Card ids present before this turn: a degraded turn removes what
        // it streamed, never older cards (#51). Read once: a retry's own
        // streamed cards must clear on a terminal failure too (#146).
        const beforeIds = new Set(
          (this.opts.reviews.getSnapshot(reviewId)?.pages.find((p) => p.id === "root")?.cards ?? []).map((c) => c.id),
        );
        // #146: the reader retries once on a fresh session when a turn
        // observably hit a dead review-MCP connection, like fork jobs. The
        // retry gets a fresh per-run secret and session, never the dead
        // turn's. Anything else (including a second connection failure) is
        // terminal.
        for (let attempt = 0; ; attempt++) {
          const mcp = this.opts.mcp.issueSession(reviewId, `reader-${reviewId}`, "reader");
          const session = await this.opts.runner.start({
            provider: settings.main.provider,
            model: settings.main.model,
            cwd: this.worktreeOf(reviewId),
            systemPrompt: instructions,
            mcpServers: [{ name: "unvibe", url: `${this.mcpBaseUrl}${mcp.path}` }],
          });
          ctx.setSessionId(session.id);
          try {
            let buffer = "";
            const streamed = new Set<number>();
            const mcpBefore = this.opts.mcp.activitySnapshot(reviewId);
            const { text, usage } = await collectStreaming(
              this.opts.runner,
              session,
              prompt,
              ctx.signal,
              (delta) => {
                ctx.reportText(delta);
                buffer += delta;
                try {
                  const partials = parseCardsPartial(buffer);
                  // An untitled first section is held back: it is either
                  // preamble (dropped) or settled by the final apply.
                  const skip = partials[0]?.title === null ? 1 : 0;
                  for (let i = skip; i < partials.length; i++) {
                    const p = partials[i];
                    const index = i - skip;
                    if (streamed.has(index)) continue;
                    streamed.add(index);
                    void this.applyReaderCard(reviewId, index, p.title, p.blocks);
                  }
                } catch {
                  // ignore mid-stream
                }
              },
              () => {
                // Text written before a tool call and before any card heading
                // is the agent narrating its exploration, not card content.
                if (!/^## /m.test(buffer)) buffer = "";
              },
            );
            ctx.reportUsage(usage);
            throwIfMcpRefusal(text);
            await this.recordUsage(reviewId, usage);
            // Issue #50: reader cards match their own `##` titles.
            const { cards, data, validation, body } = this.parseAndValidate(reviewId, buffer, []);
            let finalCards = cards;
            let finalData = data;
            let finalValidation = validation;
            let finalBody = body;
            // Reader turns keep #51's terminal rule (guide cards have
            // their own integrity path; a weakened guide is not stored).
            this.throwIfDegradedTurn(reviewId, mcpBefore, data, body, cards.flatMap((c) => c.blocks).length);
            if (validation.needsRepairTurn) {
              const anchorProblem =
                validation.anchor && !validation.anchor.ok
                  ? `\nAnchor problem: ${validation.anchor.reason}. Reply with the same cards and a corrected anchor host (the host block's ID).\n`
                  : "";
              const repairPrompt =
                `Some citations in your previous reply could not be verified:\n` +
                validation.tokens
                  .filter((t) => t.status === "unverified")
                  .map((t) => `- ${t.target}: ${t.reason ?? "unknown"}`)
                  .join("\n") +
                anchorProblem +
                `\nReply with the same cards and corrected citation tokens. End with the same trailing JSON block.`;
              // #124: the repair prompt names the failed citations, so keep
              // it on the job's stored prompt — the Debug page then shows
              // what failed (prompt wording, an ID shape, or the validator).
              ctx.setPromptSnapshot(`${prompt}\n\n--- repair turn ---\n${repairPrompt}`);
              const repair = await collectStreaming(this.opts.runner, session, repairPrompt, ctx.signal, (d) =>
                ctx.reportText(d),
              );
              usage.inputTokens += repair.usage.inputTokens;
              usage.cachedReadTokens += repair.usage.cachedReadTokens;
              usage.cachedWriteTokens += repair.usage.cachedWriteTokens;
              usage.outputTokens += repair.usage.outputTokens;
              ctx.reportUsage(repair.usage);
              throwIfMcpRefusal(repair.text);
              await this.recordUsage(reviewId, repair.usage);
              const second = this.parseAndValidate(reviewId, repair.text, []);
              finalCards = second.cards;
              finalData = second.data;
              finalValidation = second.validation;
              finalBody = second.body;
            }
            this.throwIfDegradedTurn(
              reviewId,
              mcpBefore,
              finalData,
              finalBody,
              finalCards.flatMap((c) => c.blocks).length,
            );
            // #145: diagrams the reader wrote inline in guide cards go
            // through the same finalize + one repair turn as every other
            // fill, on the reader's own session. Flattened so a bad
            // diagram costs one shared repair turn, then split back.
            const flat = finalCards.flatMap((c) => c.blocks);
            const finalized = await this.finalizeInlineBlocks(
              reviewId,
              session,
              ctx.signal,
              `Guide: ${finalCards.map((c) => c.title ?? "(untitled)").join(" / ")}`,
              "standard",
              flat,
              (u) => ctx.reportUsage(u),
            );
            const withDiagrams = splitFinalizedBlocks(finalCards, finalized);
            await this.applyReaderResult(reviewId, withDiagrams, finalData, finalValidation);
            // #122: the guide cards are already applied above; bookkeeping
            // joins the per-review chain (still awaited before the job ends).
            await this.finishBookkeeping(reviewId, () => this.ingestTurn(reviewId, { sessionId: session.id, data: finalData }));
            this.setStage(reviewId, "reader", "done");
            // Awaited: the reader job ends with its follow-ups enqueued and
            // the cited-hunk repair applied (#123), never floating behind it.
            await this.enqueueAfterReader(reviewId);
            // #122: the guide just landed — build the base before the next click.
            this.warmBase(reviewId);
            return;
        } catch (err) {
          // One retry on a fresh session when the turn observably hit a
          // dead review-MCP connection (#146, like fork jobs): the loop
          // re-issues the secret and session above. Provisional ids are
          // deterministic (`readerCardId`), so the retry's streams overwrite
          // this attempt's partials instead of duplicating them; the final
          // apply drops whatever the winning attempt did not reproduce.
          // Usage already reported + recorded per attempt above lands in the
          // totals exactly once per attempt — never twice, never lost.
          if (err instanceof DegradedConnError && attempt < 1) continue;
          // Terminal. The stage error is reader-facing (plain words, #45:
          // no MCP, no tool names); the raw reason stays on the job error
          // for the Debug page. Retry is the guide's Retry control (#86).
          this.setStage(
            reviewId,
            "reader",
            "error",
            err instanceof DegradedConnError
              ? "The guide couldn't be started because the review details couldn't be reached. Please retry."
              : (err as Error).message,
          );
          if (err instanceof DegradedTurnError) {
            // A degraded turn must leave no card behind: provisional cards
            // streamed mid-turn may already hold the chatter (#51).
            await this.opts.reviews.mutate(reviewId, (draft) => {
              const root = draft.pages.find((p) => p.id === "root");
              if (!root) return;
              root.cards = root.cards.filter((c) => beforeIds.has(c.id));
            }).catch(() => {});
          }
          throw err;
        } finally {
          try {
            await this.opts.runner.close(session);
          } catch {
            // ignore
          }
          // The reader session is closed: its MCP secret dies with it.
          // Per attempt, so a retry never reuses the dead turn's secret.
          this.opts.mcp.revokeSession(mcp.secret);
          }
        }
      },
    });
  }

  private async applyReaderCard(
    reviewId: string,
    index: number,
    title: string | null,
    blocks: Block[],
  ): Promise<void> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return;
    const lookup = this.lookupWithAliases(snapshot);
    const validation = validateReply(blocks, lookup);
    const fixed = this.withValidation(reviewId, blocks, validation);
    const provisionalId = readerCardId(index);
    await this.opts.reviews.mutate(reviewId, (draft) => {
      let root = draft.pages.find((p) => p.id === "root");
      if (!root) {
        root = { id: "root", kind: "root", title: DEFAULT_GUIDE_TITLE, saved: false, cards: [] };
        draft.pages.unshift(root);
      }
      const existing = root.cards.find((c) => c.id === provisionalId);
      if (existing) {
        existing.title = title;
        existing.blocks = fixed;
      } else {
        root.cards.push({
          id: provisionalId,
          pageId: "root",
          title,
          level: "standard",
          collapsed: false,
          revision: 1,
          blocks: fixed,
          undoStack: [],
        });
      }
      this.markFirstCard(draft);
    });
  }

  private async applyReaderResult(
    reviewId: string,
    cards: ParsedCard[],
    data: ReplyData | null,
    validation: ReturnType<typeof validateReply>,
  ): Promise<void> {
    const applied = readerApply(
      cards.map((c) => ({ title: c.title, blocks: c.blocks })),
      (data ?? null) as Record<string, unknown> | null,
    );
    // Issue #169: validate the reader's plotline hunk IDs like any other
    // ID before storing. Unknown IDs are dropped, a twice-claimed hunk
    // keeps its first plotline; hunks left out stay unassigned ("other").
    const knownPlotHunks = new Set<string>();
    for (const f of this.opts.reviews.getSnapshot(reviewId)?.files ?? []) {
      for (const h of f.hunks) knownPlotHunks.add(`h:${f.fileKey}:${h.contentHash}`);
    }
    const plotlines = normalizePlotlines(applied.plotlines, knownPlotHunks);
    const dropped = plotlines.dropped;
    if (dropped.unknown.length > 0 || dropped.duplicates.length > 0 || dropped.extraPlotlines > 0) {
      console.warn(
        `[reader] ${reviewId}: plotlines dropped ` +
          `${dropped.unknown.length} unknown hunk IDs` +
          (dropped.unknown.length > 0 ? ` (${dropped.unknown.slice(0, 5).join(", ")})` : "") +
          `, ${dropped.duplicates.length} duplicates, ${dropped.extraPlotlines} extra plotlines`,
      );
    }
    await this.opts.reviews.mutate(reviewId, (draft) => {
      let root = draft.pages.find((p) => p.id === "root");
      if (!root) {
        root = { id: "root", kind: "root", title: DEFAULT_GUIDE_TITLE, saved: false, cards: [] };
        draft.pages.unshift(root);
      }
      for (const c of applied.cards) {
        const fixed = this.withValidation(reviewId, c.blocks, validation);
        const existing = root.cards.find((x) => x.id === c.id);
        if (existing) {
          existing.title = c.title;
          existing.blocks = fixed;
          existing.revision += 1;
        } else {
          root.cards.push({
            id: c.id,
            pageId: "root",
            title: c.title,
            level: "standard",
            collapsed: false,
            revision: 1,
            blocks: fixed,
            undoStack: [],
          });
        }
      }
      const order = applied.cards.map((c) => c.id);
      // The final reply is authoritative: a streamed card it does not
      // contain (preamble, or a card the repair turn dropped) goes.
      root.cards = root.cards.filter((c) => order.includes(c.id) || !isDefaultReaderCardId(c.id));
      root.cards.sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return 0;
      });
      for (const p of applied.pendingCards) {
        if (root.cards.some((c) => c.id === p.id)) continue;
        root.cards.push({
          id: p.id,
          pageId: "root",
          title: p.label,
          level: "standard",
          collapsed: false,
          revision: 1,
          blocks: [],
          undoStack: [],
          pending: { label: p.label, why: p.why },
        });
      }
      for (const c of applied.concepts) {
        if (draft.pages.some((p) => p.id === `c-${c.slug}`)) continue;
        draft.pages.push({
          id: `c-${c.slug}`,
          kind: "concept",
          title: c.title,
          saved: true,
          parent: "root",
          cards: [
            {
              id: `cc-${c.slug}`,
              pageId: `c-${c.slug}`,
              title: null,
              level: "standard",
              collapsed: false,
              revision: 1,
              blocks: [{ type: "paragraph", id: "b1", text: { standard: c.summary }, citations: [] }],
              undoStack: [],
            },
          ],
        });
      }
      // Issue #169: store the validated plotlines; per-hunk assignment
      // rides `HunkState.plotline` (content-hash keyed, like summaries).
      draft.plotlines = plotlines.plotlines;
      for (const [hid, pid] of Object.entries(plotlines.assignment)) {
        const hash = hid.slice(hid.lastIndexOf(":") + 1);
        let state = draft.hunkStates.find((s) => s.contentHash === hash);
        if (!state) {
          state = { contentHash: hash, folded: false, reviewed: false };
          draft.hunkStates.push(state);
        }
        state.plotline = pid;
      }
      this.markFirstCard(draft);
      const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
      draft.logTail.push({
        seq,
        kind: "new-card",
        payload: { summary: "reader published problem + central", unverified: validation.unverified },
        scope: { scope: "global" },
      });
    });
    await this.persistPins(reviewId);
    await this.updateRestatedMapping(reviewId);
  }

  // -- after reader ---------------------------------------------------

  private async enqueueAfterReader(reviewId: string): Promise<Job[]> {
    const out: Job[] = [];
    this.setStage(reviewId, "base", "running");
    out.push(...(await this.enqueueCritic(reviewId)));
    out.push(...(await this.enqueueConcepts(reviewId)));
    // #123: the hunk pass starts in startReview now (at ingest), not here.
    // Hunks hidden before the guide existed are unhidden when cited.
    await this.unhideCitedHunks(reviewId);
    // Issue #107: past the fan-out limit the ingest-time pass enqueues
    // nothing (no guide exists yet to cite), so fan out the guide-cited
    // hunks now that the reader landed; the rest stay on demand. Under the
    // limit the ingest pass already covers every hunk.
    const snapshotNow = this.opts.reviews.getSnapshot(reviewId);
    const hunkCount = snapshotNow?.files.reduce((n, f) => n + f.hunks.length, 0) ?? 0;
    if (hunkCount > DEFAULT_HUNK_PASS_FANOUT_LIMIT) {
      out.push(...(await this.enqueueHunkPass(reviewId)));
    }
    // Issue #169: on degraded reader rungs the follow-up assign step
    // places the hunks the reader never saw; otherwise left-outs stay
    // "other".
    out.push(...(await this.maybeEnqueuePlotlineAssign(reviewId)));
    if (this.opts.reviews.getSnapshot(reviewId)?.review.repoId === "demo") {
      out.push(...(await this.enqueueDemoFill(reviewId)));
    }
    return out;
  }

  private async enqueueCritic(reviewId: string): Promise<Job[]> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return [];
    this.setStage(reviewId, "critic", "running");
    const settings = await this.effectiveSettings();
    const lib = loadTemplatesDirSync(this.promptsDir);
    const basePrompt = renderTemplate(lib.get("critic")!, {});
    // Replay keys select the f-lf/f-perf recordings; live runs get neutral
    // ids (page titles carry the meaning; ids are opaque).
    const replay = isReplayRunner(this.opts.runner);
    const keys = replay ? ["f-lf", "f-perf"] : ["f-critic-0", "f-critic-1"];
    return keys.map((key) => {
      const prompt = replay ? withReplayMark(basePrompt, { kind: "critic", key }) : basePrompt;
      return this.opts.jobs.enqueue({
        reviewId,
        kind: "critic",
        provider: settings.main.provider,
        model: settings.main.model,
        priority: JOB_PRIORITY.background,
        dedupe: { anchor: `finding:${key}`, requestKind: "critic", baseVersion: `v${snapshot.version.n}` },
        run: async (ctx) => {
          ctx.setPromptSnapshot(prompt);
          const base = await this.ensureBase(reviewId);
          void base;
          const forked = await this.forkFor(reviewId);
          ctx.setSessionId(forked.session.id);
          try {
            const { text, usage } = await collectStreaming(this.opts.runner, forked.session, prompt, ctx.signal, (d) =>
              ctx.reportText(d),
            );
            ctx.reportUsage(usage);
            throwIfMcpRefusal(text);
            await this.recordUsage(reviewId, usage);
            // Issue #50: finding cards match their own `##` titles.
            const { cards, data, validation } = this.parseAndValidate(reviewId, text, []);
            const applied = criticApply(
              cards.map((c) => ({ title: c.title, blocks: c.blocks })),
              (data ?? null) as Record<string, unknown> | null,
              key,
            );
            const fixedCards = applied.cards.map((c) => ({ ...c, blocks: this.withValidation(reviewId, c.blocks, validation) }));
            await this.opts.reviews.mutate(reviewId, (draft) => {
              if (draft.pages.some((p) => p.id === applied.pageId)) return;
              draft.pages.push({
                id: applied.pageId,
                kind: "finding",
                title: applied.title,
                saved: false,
                parent: "root",
                confidence: applied.confidence,
                summary: applied.summary,
                cards: fixedCards.map((c) => ({
                  id: c.id,
                  pageId: applied.pageId,
                  title: c.title,
                  level: "standard",
                  collapsed: false,
                  revision: 1,
                  blocks: c.blocks,
                  undoStack: [],
                })),
              });
              if (applied.suggestedComment) {
                // Suggested comments go through comments/threads.ts (M6):
                // buildAnchor derives prefix/suffix/position from the diff.
                const parsed = parseId(applied.suggestedComment.diff);
                if (parsed?.kind === "diff") {
                  const before = this.opts.reviews.getSnapshot(reviewId);
                  const aliases = aliasesForReview(
                    before ?? (draft as unknown as ReviewSnapshot),
                    this.opts.fixturesDir,
                  );
                  const fileKey = aliases[parsed.fileKey] ?? parsed.fileKey;
                  let quote = "";
                  for (const f of draft.files) {
                    if (f.fileKey !== fileKey) continue;
                    for (const h of f.hunks) {
                      for (const row of h.lines) {
                        if (row.newLine === parsed.start) quote = row.text;
                      }
                    }
                  }
                  try {
                    const thread = createSuggestedCommentInDraft(
                      draft,
                      before ?? (draft as unknown as ReviewSnapshot),
                      {
                        anchor: { where: "diff-line", fileKey, line: parsed.start },
                        quote,
                        suggestionText: applied.suggestedComment.text,
                      },
                    );
                    // Tie the thread back to the finding (PRD §4.9): a
                    // comment-link block on the Assessment (last) card.
                    // Hover previews the thread, click jumps to the diff.
                    const page = draft.pages.find((p) => p.id === applied.pageId);
                    const last = page?.cards[page.cards.length - 1];
                    if (last) {
                      const range =
                        parsed.start === parsed.end ? `${parsed.start}` : `${parsed.start}-${parsed.end}`;
                      const diffRef = `diff:${fileKey}:${range}`;
                      last.blocks.push({
                        type: "comment-link",
                        id: "b-comment",
                        diffRef,
                        threadId: thread.id,
                        citations: [{ target: diffRef }],
                      });
                    }
                  } catch {
                    // Unknown file/line: keep the finding, skip the draft.
                  }
                }
              }
              const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
              draft.logTail.push({
                seq,
                kind: "new-finding",
                payload: { summary: `${applied.title}\n\n${applied.summary}`, unverified: validation.unverified },
                scope: { scope: "global" },
              });
            });
            await this.updateRestatedMapping(reviewId);
            // #122: the finding is applied above; bookkeeping joins the chain.
            await this.finishBookkeeping(reviewId, () => this.ingestTurn(reviewId, { sessionId: forked.session.id, data }));
            // #122: findings changed the guide — rebuild the base ahead.
            this.warmBase(reviewId);
            this.maybeMarkStageDone(reviewId, "critic", 2);
          } catch (err) {
            this.setStage(reviewId, "critic", "error", (err as Error).message);
            throw err;
          }
        },
      });
    });
  }

  private async enqueueConcepts(reviewId: string): Promise<Job[]> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return [];
    this.setStage(reviewId, "concepts", "running");
    const settings = await this.effectiveSettings();
    const promptBase = `Write concept stubs for this review. For each hidden concept candidate the reader named, emit one line with its concept: slug, title, one line of meaning, and where mentioned. End with a trailing JSON block carrying the concepts array (slug, title, summary).`;
    const prompt = isReplayRunner(this.opts.runner) ? withReplayMark(promptBase, { kind: "concept-stubs" }) : promptBase;
    const job = this.opts.jobs.enqueue({
      reviewId,
      kind: "concept",
      provider: settings.main.provider,
      model: settings.main.model,
      priority: JOB_PRIORITY.background,
      dedupe: { anchor: "concepts", requestKind: "concept-stubs", baseVersion: `v${snapshot.version.n}` },
      run: async (ctx) => {
        ctx.setPromptSnapshot(prompt);
        const base = await this.ensureBase(reviewId);
        void base;
        const forked = await this.forkFor(reviewId);
        ctx.setSessionId(forked.session.id);
        try {
          const { text, usage } = await collectStreaming(this.opts.runner, forked.session, prompt, ctx.signal, (d) =>
            ctx.reportText(d),
          );
          ctx.reportUsage(usage);
          throwIfMcpRefusal(text);
          await this.recordUsage(reviewId, usage);
          const { data } = this.parseAndValidate(reviewId, text);
          const concepts = ((data?.["concepts"] as { slug?: string; title?: string; summary?: string }[] | undefined) ?? []).filter(
            (c) => c.slug,
          );
          await this.opts.reviews.mutate(reviewId, (draft) => {
            for (const c of concepts) {
              if (draft.pages.some((p) => p.id === `c-${c.slug}`)) continue;
              draft.pages.push({
                id: `c-${c.slug}`,
                kind: "concept",
                title: c.title ?? c.slug!,
                saved: true,
                parent: "root",
                cards: [
                  {
                    id: `cc-${c.slug}`,
                    pageId: `c-${c.slug}`,
                    title: null,
                    level: "standard",
                    collapsed: false,
                    revision: 1,
                    blocks: [{ type: "paragraph", id: "b1", text: { standard: c.summary ?? "" }, citations: [] }],
                    undoStack: [],
                  },
                ],
              });
            }
          });
          this.setStage(reviewId, "concepts", "done");
          // Demo auto-fill: expand every stub to its full page (same path as
          // on-demand `ensureConceptPage`, background priority).
          if (this.opts.reviews.getSnapshot(reviewId)?.review.repoId === "demo") {
            for (const c of concepts) {
              if (!c.slug) continue;
              try {
                await this.ensureConceptPageInner(reviewId, c.slug);
              } catch {
                // best-effort; resume will retry
              }
            }
          }
          // #122: stubs changed the guide — rebuild the base ahead.
          this.warmBase(reviewId);
        } catch (err) {
          this.setStage(reviewId, "concepts", "error", (err as Error).message);
          throw err;
        }
      },
    });
    return [job];
  }

  private async enqueueHunkPass(reviewId: string): Promise<Job[]> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return [];
    this.setStage(reviewId, "hunk-pass", "running");
    const settings = await this.effectiveSettings();
    const hunks = snapshot.files.flatMap((f) => f.hunks.map((h) => ({ file: f, hunk: h })));
    // Issue #107: past the fan-out limit there is no per-hunk fan-out —
    // only guide-cited hunks lacking a stored summary are enqueued, and
    // everything else summarises on demand (`POST …/hunks/:hash/summarize`,
    // Fold-all). At ingest (#123 starts the pass here) no guide exists yet,
    // so the cited set is empty and the stage reaches done with no jobs;
    // `enqueueAfterReader` fans out the cited hunks once the reader lands.
    // Resume re-runs this same branch — never the full fan-out.
    const overLimit = hunks.length > DEFAULT_HUNK_PASS_FANOUT_LIMIT;
    const targets = overLimit
      ? hunks.filter(({ hunk }) => {
          if (!this.isCitedByGuide(reviewId, hunk.contentHash)) return false;
          return snapshot.hunkStates.find((s) => s.contentHash === hunk.contentHash)?.summary === undefined;
        })
      : hunks;
    if (targets.length === 0) {
      this.setStage(reviewId, "hunk-pass", "done");
      return [];
    }
    this.hunkPassCompleted.set(reviewId, 0);
    return targets.map(({ file, hunk }) =>
      this.enqueueOneHunkPass(reviewId, snapshot, file, hunk, settings.small, targets.length),
    );
  }

  private enqueueOneHunkPass(
    reviewId: string,
    snapshot: ReviewSnapshot,
    file: ReviewSnapshot["files"][number],
    hunk: ReviewSnapshot["files"][number]["hunks"][number],
    small: { provider: string; model: string },
    expectedJobs: number,
  ): Job {
    const hunkText = this.formatHunkForPrompt(snapshot, file.fileKey, hunk.contentHash);
    const cited = this.isCitedByGuide(reviewId, hunk.contentHash);
    const body = cited ? `${hunkText}\n\nCITED-BY-GUIDE` : hunkText;
    const replayKey = this.replayKeyForHunk(snapshot, file.fileKey, hunk.contentHash);
    const prompt = withReplayMark(
      this.render("hunk_pass", { hunk: body, path: file.path }),
      isReplayRunner(this.opts.runner) && replayKey ? { kind: "hunk", key: replayKey } : undefined,
    );
    return this.opts.jobs.enqueue({
      reviewId,
      kind: "hunk-pass",
      provider: small.provider,
      model: small.model,
      priority: JOB_PRIORITY.background,
      dedupe: { anchor: `hunk:${hunk.contentHash}`, requestKind: "hunk-pass", baseVersion: `v${snapshot.version.n}` },
      run: async (ctx) => {
        ctx.setPromptSnapshot(prompt);
        const session = await this.opts.runner.start({
          provider: small.provider,
          model: small.model,
          cwd: this.worktreeOf(reviewId),
          systemPrompt: "",
          mcpServers: [],
        });
        ctx.setSessionId(session.id);
        try {
          const { text, usage } = await collectStreaming(this.opts.runner, session, prompt, ctx.signal, (d) =>
            ctx.reportText(d),
          );
          ctx.reportUsage(usage);
          await this.recordUsage(reviewId, usage);
          const { data } = this.parseAndValidate(reviewId, text);
          await this.applyHunkSummary(reviewId, hunk.contentHash, parseHunkReply(text, data));
          this.markHunkPassComplete(reviewId, expectedJobs);
        } catch (err) {
          this.setStage(reviewId, "hunk-pass", "error", (err as Error).message);
          throw err;
        } finally {
          try {
            await this.opts.runner.close(session);
          } catch {
            // ignore
          }
        }
      },
    });
  }

  /**
   * Record one hunk-pass job's success; mark the stage done once every job
   * of the last fan-out completed. Never overwrites an error set by a
   * failed sibling (resume retries it).
   */
  private markHunkPassComplete(reviewId: string, expectedJobs: number): void {
    try {
      const completed = (this.hunkPassCompleted.get(reviewId) ?? 0) + 1;
      this.hunkPassCompleted.set(reviewId, completed);
      if (completed < expectedJobs) return;
      const errored = this.opts.jobs
        .listByReview(reviewId)
        .some((j) => j.kind === "hunk-pass" && j.state === "error");
      if (!errored) this.setStage(reviewId, "hunk-pass", "done");
    } catch {
      // ignore
    }
  }

  /**
   * Issue #169 large-PR fallback (#107): the reader names plotlines and
   * assigns the hunks it saw, by hunk ID in one go. On degraded rungs it
   * never saw every ID (uninteresting files collapse to one line, then
   * files-only/counts-only drop hunk rows), so one small-model step
   * assigns the hunks whose IDs stayed invisible. Hunks the reader saw
   * and left out stay "other" by choice; past `PLOTLINE_ASSIGN_CAP`
   * invisible hunks the rest also stay "other" — classifying thousands
   * of hunks would cost a second hunk pass, exactly what the fan-out
   * limit refuses to pay. At most one attempt per review version (a
   * finished job is never re-enqueued; an errored one retries through
   * resume).
   */
  private async maybeEnqueuePlotlineAssign(reviewId: string): Promise<Job[]> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return [];
    const plotlines = snapshot.plotlines ?? [];
    if (plotlines.length === 0) return [];
    const attempted = this.opts.jobs
      .listByReview(reviewId)
      .some(
        (j) =>
          j.kind === "plotline-assign" &&
          (j.state === "queued" || j.state === "running" || j.state === "backing-off" || j.state === "done"),
      );
    if (attempted) return [];
    const assigned = new Set(
      snapshot.hunkStates.filter((s) => s.plotline !== undefined).map((s) => s.contentHash),
    );
    const settings = await this.effectiveSettings();
    // The ladder is deterministic: rebuild it to learn exactly which hunk
    // IDs the reader saw (inlined + summarized). Anything assigned or
    // visible stays out of the follow-up.
    const promptSnap = toPromptSnapshot(snapshot, { model: settings.main.model });
    const ladder = buildLadder(promptSnap, { inlineBudgetTokens: settings.inlineBudgetTokens });
    const seen = new Set([...ladder.inlinedHunkIds, ...ladder.summarizedHunkIds]);
    const unassigned = snapshot.files.flatMap((f) =>
      f.hunks
        .filter((h) => !assigned.has(h.contentHash) && !seen.has(`h:${f.fileKey}:${h.contentHash}`))
        .map((h) => ({ file: f, hunk: h })),
    );
    if (unassigned.length === 0) return [];
    if (unassigned.length > PLOTLINE_ASSIGN_CAP) {
      console.warn(
        `[reader] ${reviewId}: ${unassigned.length} hunks left out of plotlines past the assign cap (${PLOTLINE_ASSIGN_CAP}); leaving them in "other"`,
      );
      return [];
    }
    const plotlineList = plotlines
      .map((p) => `- ${p.id}: ${p.name}${p.description ? ` — ${p.description}` : ""}`)
      .join("\n");
    const hunkList = unassigned
      .map(({ file, hunk }) => {
        const summary = snapshot.hunkStates.find((s) => s.contentHash === hunk.contentHash)?.summary;
        return `- h:${file.fileKey}:${hunk.contentHash} ${file.path}: ${summary ?? hunk.header}`;
      })
      .join("\n");
    const prompt = this.render("plotline_assign", { plotlines: plotlineList, hunks: hunkList });
    const job = this.opts.jobs.enqueue({
      reviewId,
      kind: "plotline-assign",
      provider: settings.small.provider,
      model: settings.small.model,
      priority: JOB_PRIORITY.background,
      dedupe: { anchor: "plotlines", requestKind: "plotline-assign", baseVersion: `v${snapshot.version.n}` },
      run: async (ctx) => {
        ctx.setPromptSnapshot(prompt);
        const session = await this.opts.runner.start({
          provider: settings.small.provider,
          model: settings.small.model,
          cwd: this.worktreeOf(reviewId),
          systemPrompt: "",
          mcpServers: [],
        });
        ctx.setSessionId(session.id);
        try {
          const { text, usage } = await collectStreaming(this.opts.runner, session, prompt, ctx.signal, (d) =>
            ctx.reportText(d),
          );
          ctx.reportUsage(usage);
          await this.recordUsage(reviewId, usage);
          // Malformed trailing JSON fails the job (visible on Debug);
          // a missing block or zero usable assignments keeps "other".
          const { data } = this.parseAndValidate(reviewId, text);
          const raw = (data as Record<string, unknown> | null)?.["assignments"];
          const live = this.opts.reviews.getSnapshot(reviewId);
          if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !live) return;
          const ids = new Set(plotlines.map((p) => p.id));
          const known = new Set<string>();
          for (const f of live.files) for (const h of f.hunks) known.add(`h:${f.fileKey}:${h.contentHash}`);
          const taken = new Set(
            live.hunkStates.filter((s) => s.plotline !== undefined).map((s) => s.contentHash),
          );
          let applied = 0;
          let dropped = 0;
          await this.opts.reviews.mutate(reviewId, (draft) => {
            for (const [hid, pid] of Object.entries(raw as Record<string, unknown>)) {
              const parsed = parseId(hid);
              if (parsed?.kind !== "h") {
                dropped += 1;
                continue;
              }
              const canonical = `h:${parsed.fileKey}:${parsed.contentHash}`;
              if (!known.has(canonical) || typeof pid !== "string" || !ids.has(pid)) {
                dropped += 1;
                continue;
              }
              if (taken.has(parsed.contentHash)) {
                dropped += 1;
                continue;
              }
              taken.add(parsed.contentHash);
              let state = draft.hunkStates.find((s) => s.contentHash === parsed.contentHash);
              if (!state) {
                state = { contentHash: parsed.contentHash, folded: false, reviewed: false };
                draft.hunkStates.push(state);
              }
              state.plotline = pid;
              applied += 1;
            }
          });
          if (dropped > 0) {
            console.warn(`[reader] ${reviewId}: plotline assign step applied ${applied}, dropped ${dropped}`);
          }
        } finally {
          try {
            await this.opts.runner.close(session);
          } catch {
            // ignore
          }
        }
      },
    });
    return [job];
  }

  private async enqueueDemoFill(reviewId: string): Promise<Job[]> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return [];
    const out: Job[] = [];
    const effective = await this.effectiveSettings();
    const root = snapshot.pages.find((p) => p.id === "root");
    // Pending cards may not exist yet (reader still running when this is
    // called from enqueueAfterReader). Demo fill runs AFTER reader, so root
    // should have placeholders; if not, skip (resume will pick them up).
    const pending = root?.cards.filter((c) => c.pending) ?? [];
    for (const card of pending) {
      out.push(
        this.opts.jobs.enqueue({
          reviewId,
          kind: "go-deeper",
          provider: effective.main.provider,
          model: effective.main.model,
          priority: JOB_PRIORITY.background,
          dedupe: { anchor: `go-deeper:${card.id}`, requestKind: "go-deeper", baseVersion: `v${snapshot.version.n}` },
          run: async (ctx) => {
            await this.fillGoDeeper(reviewId, card.id, ctx.signal, (d) => ctx.reportText(d), ctx);
          },
        }),
      );
    }
    return out;
  }

  async fillGoDeeper(
    reviewId: string,
    cardId: string,
    signal: AbortSignal | undefined,
    onText: (delta: string) => void,
    ctx?: { setPromptSnapshot: (s: string) => void; setSessionId: (s: string) => void; reportUsage: (u: TokenUsage) => void },
  ): Promise<void> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) throw new Error(`unknown review ${reviewId}`);
    const root = snapshot.pages.find((p) => p.id === "root");
    const card = root?.cards.find((c) => c.id === cardId);
    if (!card?.pending) throw new Error(`no pending card ${cardId}`);
    const direction = `${card.pending.label}\n${card.pending.why}`;
    const prompt = withReplayMark(
      this.render("go_deeper", { direction }),
      isReplayRunner(this.opts.runner) ? { kind: "go-deeper", key: cardId.replace(/^g-/, "") } : undefined,
    );
    ctx?.setPromptSnapshot(prompt);
    const base = await this.ensureBase(reviewId);
    void base;
    const forked = await this.forkFor(reviewId);
    ctx?.setSessionId(forked.session.id);
    const { text, usage } = await collectStreaming(this.opts.runner, forked.session, prompt, signal, onText);
    ctx?.reportUsage(usage);
    throwIfMcpRefusal(text);
    await this.recordUsage(reviewId, usage);
    // Issue #50: match the placeholder label (the card's future title).
    const { cards, data, validation } = this.parseAndValidate(reviewId, text, [card.pending.label]);
    const blocks = this.withValidation(
      reviewId,
      cards.flatMap((c) => c.blocks),
      validation,
    );
    // Inline diagrams go through finalize + one repair turn on the fill's
    // own session (#130), so stored blocks carry a real status.
    const stored = await this.finalizeInlineBlocks(
      reviewId,
      forked.session,
      signal,
      direction,
      "standard",
      blocks,
      (u) => ctx?.reportUsage(u),
    );
    const title = (data?.["title"] as string | undefined) ?? card.pending.label;
    await this.opts.reviews.mutate(reviewId, (draft) => {
      const r = draft.pages.find((p) => p.id === "root");
      const c = r?.cards.find((x) => x.id === cardId);
      if (!c) return;
      c.title = title;
      c.blocks = stored;
      delete c.pending;
      c.revision += 1;
      const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
      draft.logTail.push({
        seq,
        kind: "new-card",
        payload: { summary: `go-deeper ${cardId}`, unverified: validation.unverified },
        scope: { scope: "global" },
      });
      // On-demand stage bookkeeping: once the last placeholder is filled,
      // the go-deeper stage is done (readiness ignores a pending go-deeper,
      // but the stored stage should still settle).
      if (r && !r.cards.some((x) => x.pending)) {
        if (!draft.pipeline) {
          draft.pipeline = {
            stages: { reader: "pending", base: "pending", critic: "pending", concepts: "pending", "hunk-pass": "pending", "go-deeper": "pending" },
          };
        }
        (draft.pipeline.stages as Record<string, string>)["go-deeper"] = "done";
      }
    });
    await this.updateRestatedMapping(reviewId);
    // #122: the fill is applied above; bookkeeping joins the chain.
    await this.finishBookkeeping(reviewId, () => this.ingestTurn(reviewId, { sessionId: forked.session.id, cardId, data }));
    // #122: the fill changed the guide — rebuild the base ahead.
    this.warmBase(reviewId);
  }

  private async ensureConceptPageInner(reviewId: string, slug: string): Promise<void> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return;
    const existing = snapshot.pages.find((p) => p.id === `c-${slug}`);
    const prompt = withReplayMark(
      this.render("concept_page", { concept: `${slug} — ${existing?.title ?? slug}`, mentions: this.mentionsOf(snapshot, slug) }),
      isReplayRunner(this.opts.runner) ? { kind: "concept-page", key: slug } : undefined,
    );
    const base = await this.ensureBase(reviewId);
    void base;
    const forked = await this.forkFor(reviewId);
    const { text, usage } = await collectStreaming(this.opts.runner, forked.session, prompt, undefined, () => {});
    throwIfMcpRefusal(text);
    await this.recordUsage(reviewId, usage);
    // Issue #50: match the page title (an echo of the concept name).
    const { cards, data, validation } = this.parseAndValidate(reviewId, text, [
      ...(existing?.title ? [existing.title] : []),
      slug,
    ]);
    const title = (data?.["title"] as string | undefined) ?? existing?.title ?? slug;
    const blocks = this.withValidation(
      reviewId,
      cards.flatMap((c) => c.blocks),
      validation,
    );
    // Inline diagrams go through finalize + one repair turn on the fill's
    // own session (#130), so stored blocks carry a real status.
    const stored = await this.finalizeInlineBlocks(
      reviewId,
      forked.session,
      undefined,
      `Concept page: ${slug}`,
      "standard",
      blocks,
    );
    await this.opts.reviews.mutate(reviewId, (draft) => {
      let page = draft.pages.find((p) => p.id === `c-${slug}`);
      if (!page) {
        page = { id: `c-${slug}`, kind: "concept", title, saved: true, parent: "root", cards: [] };
        draft.pages.push(page);
      }
      page.title = title;
      page.cards = [
        {
          id: `cc-${slug}`,
          pageId: `c-${slug}`,
          title: null,
          level: "standard",
          collapsed: false,
          revision: (page.cards[0]?.revision ?? 0) + 1,
          blocks: stored,
          undoStack: [],
        },
      ];
    });
  }

  // -- helpers --------------------------------------------------------

  private formatHunkForPrompt(snapshot: ReviewSnapshot, fileKey: string, contentHash: string): string {
    const file = snapshot.files.find((f) => f.fileKey === fileKey);
    const hunk = file?.hunks.find((h) => h.contentHash === contentHash);
    if (!file || !hunk) return `(unknown hunk ${contentHash})`;
    const lines = hunk.lines
      .map((l) => (l.kind === "add" ? `+${l.text}` : l.kind === "del" ? `-${l.text}` : ` ${l.text}`))
      .join("\n");
    return `### [[h:${fileKey}:${contentHash}]] ${file.path}\n${hunk.header}\n${lines}`;
  }

  private replayKeyForHunk(snapshot: ReviewSnapshot, fileKey: string, contentHash: string): string | null {
    const aliases = aliasesForReview(snapshot, this.opts.fixturesDir);
    const rev = Object.entries(aliases).find(([, v]) => v === fileKey)?.[0];
    const file = snapshot.files.find((f) => f.fileKey === fileKey);
    if (!file) return null;
    const index = file.hunks.findIndex((h) => h.contentHash === contentHash);
    if (index < 0) return null;
    if (rev) return `${rev}:${index}`;
    return null;
  }

  private isCitedByGuide(reviewId: string, contentHash: string): boolean {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return false;
    const targets = new Set<string>();
    for (const page of snapshot.pages) {
      for (const card of page.cards) {
        for (const b of card.blocks) {
          for (const c of citationsOf(b)) targets.add(c);
        }
      }
    }
    for (const t of targets) {
      const parsed = parseId(t);
      if (!parsed) continue;
      if (parsed.kind === "h" && parsed.contentHash === contentHash) return true;
      if (parsed.kind === "diff") {
        const aliases = aliasesForReview(snapshot, this.opts.fixturesDir);
        const fk = aliases[parsed.fileKey] ?? parsed.fileKey;
        const file = snapshot.files.find((f) => f.fileKey === fk);
        if (!file) continue;
        const hunk = file.hunks.find((h) => h.contentHash === contentHash);
        if (!hunk) continue;
        if (parsed.start <= hunk.newEnd && parsed.end >= hunk.newStart) return true;
      }
    }
    return false;
  }

  private isOneLineChange(snapshot: ReviewSnapshot, contentHash: string): boolean {
    for (const f of snapshot.files) {
      const h = f.hunks.find((x) => x.contentHash === contentHash);
      if (h) return h.added + h.removed <= 1;
    }
    return false;
  }

  private mentionsOf(snapshot: ReviewSnapshot, slug: string): string {
    const hits: string[] = [];
    for (const page of snapshot.pages) {
      for (const card of page.cards) {
        if (JSON.stringify(card.blocks).includes(`concept:${slug}`)) hits.push(`card:${card.id}`);
      }
    }
    return hits.length > 0 ? hits.slice(0, 5).join("\n") : "(mentioned in the guide)";
  }

  /**
   * Persist the reader's `pin_context` pins (PRD §9.1 L1b) with their
   * excerpt text resolved at the version head — via the same `git show`
   * source the `get_code` tool serves (`readCodeSlice`, through the
   * injectable command runner). Best-effort per pin: an unresolvable pin
   * is still stored (location + `needsRepining`) so the reader's intent
   * stays visible, and L1b renders it honestly instead of an empty fence.
   * Never throws: one bad pin must not fail the reader stage.
   */
  private async persistPins(reviewId: string): Promise<void> {
    const pins = this.opts.mcp.listPins(reviewId);
    if (pins.length === 0) return;
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return;
    const headSha = snapshot.version.headSha;
    const cwd = this.worktreeOf(reviewId);
    // Resolve text before the snapshot mutate below (recipes are sync).
    const resolved: { path: string; start: number; end: number; text: string | null }[] = [];
    for (const pin of pins) {
      const [rawStart, rawEnd] = pin.lines.split("-").map(Number);
      const start = rawStart;
      const end = rawEnd ?? rawStart;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) continue;
      let text: string | null = null;
      try {
        McpRegistry.checkPathInRepo(cwd, pin.path);
        const slice = await readCodeSlice(this.opts.commands, cwd, headSha, pin.path, start, end);
        // A range that resolves to nothing but whitespace carries no
        // excerpt: treat it like an unresolvable pin so it renders
        // honestly instead of as an empty fence.
        if ("text" in slice && slice.text.trim() !== "") text = slice.text;
      } catch {
        text = null;
      }
      resolved.push({ path: pin.path, start, end, text });
    }
    if (resolved.length === 0) return;
    await this.opts.reviews.mutate(reviewId, (draft) => {
      const byKey = new Map((draft.pinnedCode ?? []).map((p) => [`${p.path}:${p.start}-${p.end}`, p]));
      for (const r of resolved) {
        const key = `${r.path}:${r.start}-${r.end}`;
        const prev = byKey.get(key);
        const language = languageForPath(r.path);
        if (prev) {
          // Re-pin of a range whose stored excerpt is empty (on disk from
          // before text was persisted, or never resolvable until now):
          // refill it in place. Entries that already have text are left
          // alone, as are empty entries the text still does not resolve for.
          if (prev.text === "" && r.text !== null) {
            prev.text = r.text;
            prev.sha = headSha;
            if (language !== undefined) prev.language = language;
            else delete prev.language;
            delete prev.needsRepining;
            delete prev.remappedSha;
            delete prev.remappedStart;
            delete prev.remappedEnd;
          }
          continue;
        }
        const entry = {
          path: r.path,
          start: r.start,
          end: r.end,
          sha: headSha,
          text: r.text ?? "",
          ...(language !== undefined ? { language } : {}),
          ...(r.text === null ? { needsRepining: true as const } : {}),
        };
        (draft.pinnedCode ??= []).push(entry);
        byKey.set(key, entry);
      }
    });
  }

  /**
   * Recompute the description's "Restated →" mapping (PRD §4.11): paragraph
   * id → guide block ids whose citations restate it. Derived from the root
   * page's `desc:` citations; rerun as the guide grows (reader, critic
   * findings cite description too, go-deeper fills).
   */
  private async updateRestatedMapping(reviewId: string): Promise<void> {
    try {
      await this.opts.reviews.mutate(reviewId, (draft) => {
        if (!draft.description) return;
        const map: Record<string, string[]> = {};
        const root = draft.pages.find((p) => p.id === "root");
        for (const card of root?.cards ?? []) {
          for (const b of card.blocks) {
            for (const t of citationsOf(b)) {
              const parsed = parseId(t);
              if (parsed?.kind === "desc") {
                (map[parsed.paragraph] ??= []).push(b.id);
              }
            }
          }
        }
        for (const k of Object.keys(map)) map[k] = [...new Set(map[k])];
        draft.description!.restated = map;
      });
    } catch {
      // best-effort
    }
  }

  private async recordUsage(reviewId: string, usage: TokenUsage): Promise<void> {
    try {
      await this.opts.reviews.mutate(reviewId, (draft) => {
        const t = draft.usageTotals ?? {
          inputTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          outputTokens: 0,
          createdAt: draft.review.createdAt,
        };
        t.inputTokens += usage.inputTokens;
        t.cachedReadTokens += usage.cachedReadTokens;
        t.cachedWriteTokens += usage.cachedWriteTokens;
        t.outputTokens += usage.outputTokens;
        // Read share (#125, M0 pitfall #2): input counts uncached input
        // only; writes never count as hits.
        const total = t.inputTokens + t.cachedReadTokens + t.cachedWriteTokens;
        t.cacheHitRate = total > 0 ? t.cachedReadTokens / total : undefined;
        draft.usageTotals = t;
      });
    } catch {
      // best-effort
    }
  }

  private markFirstCard(draft: ReviewSnapshot): void {
    if (!draft.usageTotals?.firstCardAt) {
      draft.usageTotals = {
        inputTokens: draft.usageTotals?.inputTokens ?? 0,
        cachedReadTokens: draft.usageTotals?.cachedReadTokens ?? 0,
        cachedWriteTokens: draft.usageTotals?.cachedWriteTokens ?? 0,
        outputTokens: draft.usageTotals?.outputTokens ?? 0,
        createdAt: draft.review.createdAt,
        firstCardAt: Date.now(),
      };
    }
  }

  private async appendLog(
    reviewId: string,
    kind: string,
    payload: unknown,
    scope: { scope: "global" } | { scope: "card"; cardId: string },
  ): Promise<void> {
    try {
      await this.opts.reviews.mutate(reviewId, (draft) => {
        const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
        draft.logTail.push({ seq, kind, payload, scope });
      });
    } catch {
      // ignore
    }
  }

  private ensurePipelineField(reviewId: string): void {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot || snapshot.pipeline) return;
    void this.opts.reviews
      .mutate(reviewId, (draft) => {
        if (!draft.pipeline) {
          draft.pipeline = {
            stages: { reader: "pending", base: "pending", critic: "pending", concepts: "pending", "hunk-pass": "pending", "go-deeper": "pending" },
          };
        }
      })
      .catch(() => {});
  }

  private stageStates(reviewId: string): Record<string, string> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    const stages = (snapshot?.pipeline?.stages ?? {}) as Record<string, string>;
    return {
      reader: stages.reader ?? "pending",
      base: stages.base ?? "pending",
      critic: stages.critic ?? "pending",
      concepts: stages.concepts ?? "pending",
      "hunk-pass": stages["hunk-pass"] ?? "pending",
      "go-deeper": stages["go-deeper"] ?? "pending",
    };
  }

  private setStage(reviewId: string, stage: string, state: "pending" | "running" | "done" | "error", error?: string): void {
    void this.opts.reviews
      .mutate(reviewId, (draft) => {
        if (!draft.pipeline) {
          draft.pipeline = {
            stages: { reader: "pending", base: "pending", critic: "pending", concepts: "pending", "hunk-pass": "pending", "go-deeper": "pending" },
          };
        }
        (draft.pipeline.stages as Record<string, string>)[stage] = state;
        if (state === "error" && error) {
          draft.pipeline.errors = { ...(draft.pipeline.errors ?? {}), [stage]: error };
        }
      })
      .catch(() => {});
  }

  private maybeMarkStageDone(reviewId: string, stage: "critic" | "hunk-pass", expectedJobs: number): void {
    try {
      const jobs = this.opts.jobs.listByReview(reviewId);
      const kinds: Record<string, JobKind[]> = { critic: ["critic"], "hunk-pass": ["hunk-pass"] };
      const relevant = jobs.filter((j) => (kinds[stage] as string[]).includes(j.kind));
      // Called on the success path inside a relevant job's run(), before the
      // queue flips it to done — so the caller is still "running". Count it
      // as completing (+1); without this the last job always sees
      // done = expected-1 and the stage stays "running" forever. Never
      // overwrite an error set by a failed sibling.
      const done = relevant.filter((j) => j.state === "done").length;
      const errored = relevant.some((j) => j.state === "error");
      if (!errored && done + 1 >= expectedJobs) this.setStage(reviewId, stage, "done");
    } catch {
      // ignore
    }
  }

  updateRunner(): {
    runUpdatePrompt: (prompt: string, opts: { reviewId: string; toVersion: number; signal?: AbortSignal }) => Promise<string>;
  } {
    return {
      // The versions module renders `update_pass.md` already; run the
      // rendered prompt in a fork of the new base as an `update-pass` job.
      runUpdatePrompt: async (prompt, opts) => {
        const settings = await this.effectiveSettings();
        let resolveText!: (s: string) => void;
        let rejectText!: (e: Error) => void;
        const done = new Promise<string>((res, rej) => {
          resolveText = res;
          rejectText = rej;
        });
        this.opts.jobs.enqueue({
          reviewId: opts.reviewId,
          kind: "update-pass",
          provider: settings.main.provider,
          model: settings.main.model,
          priority: JOB_PRIORITY.userRequested,
          dedupe: { anchor: "update", requestKind: "update-pass", baseVersion: `v${opts.toVersion}` },
          promptSnapshot: prompt,
          run: async (ctx) => {
            for (let attempt = 0; ; attempt++) {
              try {
                ctx.setPromptSnapshot(prompt);
                const base = await this.ensureBase(opts.reviewId);
                void base;
                const forked = await this.forkFor(opts.reviewId);
                ctx.setSessionId(forked.session.id);
                const { text, usage } = await collectStreaming(
                  this.opts.runner,
                  forked.session,
                  prompt,
                  opts.signal ?? ctx.signal,
                  (d) => ctx.reportText(d),
                );
                ctx.reportUsage(usage);
                throwIfMcpRefusal(text);
                await this.recordUsage(opts.reviewId, usage);
                resolveText(text);
                return;
              } catch (err) {
                if (err instanceof RetryableError && attempt < 3) {
                  await sleepMs(50 * (attempt + 1));
                  continue;
                }
                rejectText(err as Error);
                throw err;
              }
            }
          },
        });
        return done;
      },
    };
  }
}
