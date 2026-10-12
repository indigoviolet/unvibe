/**
 * M3 pipeline (PRD §11): reader → base → critic/concepts → hunk pass.
 *
 * Every agent call is a job on the queue (kind, model, priority, prompt
 * snapshot, usage with cached tokens, cardId/progress). Streaming reader
 * cards go through `parseCardsPartial` → `ReviewStore.mutate` so the UI
 * fills progressively. Every reply goes through `splitReply` → parser →
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
import { canonicalizeTarget, JOB_PRIORITY, parseCards, parseCardsPartial, parseId, splitReply } from "@unvibe/shared";
import { RetryableError } from "../jobs/errors.js";
import type { JobQueue } from "../jobs/index.js";
import { McpRegistry } from "../mcp/index.js";
import { readCodeSlice } from "../mcp/index.js";
import { isNoneRunner, isReplayRunner } from "../agent/factory.js";
import { guideRevisionForSnapshot, toPromptSnapshot } from "../routes/prompts.js";import { buildBasePack, buildDiffSection, buildSourceBlurb } from "../context/index.js";
import { loadTemplatesDirSync, renderTemplate, resolvePromptsDir } from "../prompts/index.js";
import type { SessionManager } from "../sessions/manager.js";
import type { SettingsStore } from "../settings/index.js";
import type { ReviewStore } from "../state/store.js";
import type { CommandRunner } from "../exec/index.js";
import { validateReply } from "../validate/index.js";
import { lookupForSnapshot } from "./lookup.js";
import { createSuggestedCommentInDraft } from "../comments/threads.js";
import { criticApply, isDefaultReaderCardId, readerApply, readerCardId } from "./apply.js";
import { withReplayMark } from "./replayMark.js";
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
  const usage: TokenUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
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

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
      threadId?: string;
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
        ...(turn.threadId ? { threadId: turn.threadId } : {}),
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
    const settings = this.opts.settings.get();
    const base = await this.ensureBase(o.reviewId);
    const baseLogSeq = this.opts.sessions.baseInfo(base.key)?.logSeq ?? 0;
    const variables = changeListVariable(this.wireDeps(), o.reviewId, o.template, o.variables, {
      ...(o.conversationKey ? { conversationKey: o.conversationKey } : {}),
      ...(o.cardId ? { cardId: o.cardId } : {}),
      ...(o.hunkHash ? { hunkHash: o.hunkHash } : {}),
      baseLogSeq,
    });
    const template = this.render(o.template, variables);
    const prompt = withReplayMark(template, o.replay && isReplayRunner(this.opts.runner) ? o.replay : undefined);
    const provider = settings.main.provider;
    const model = settings.main.model;

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
      ...(o.threadId ? { threadId: o.threadId } : {}),
      promptSnapshot: prompt,
      run: async (ctx) => {
        // Retryable errors retry inside the job (so the deferred settles
        // once); non-retryable errors reject and mark the job error.
        for (let attempt = 0; ; attempt++) {
          try {
            ctx.setPromptSnapshot(prompt);
            const forked = await this.forkFor(o.reviewId);
            ctx.setSessionId(forked.session.id);
            let buffer = "";
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
                    const finished = partials.filter((p) => p.finished);
                    if (finished.length > 0) void o.onPartial(finished);
                  } catch {
                    // ignore mid-stream parse errors
                  }
                }
              },
            );
            throwIfMcpRefusal(text);
            const first = this.parseAndValidate(o.reviewId, text);
            let finalText = text;
            let finalCards = first.cards;
            let finalData = first.data;
            let finalValidation = first.validation;
            let repaired = false;
            if (first.validation.needsRepairTurn) {
              repaired = true;
              const repairPrompt =
                `Some citations in your previous reply could not be verified:\n` +
                first.validation.tokens
                  .filter((t) => t.status === "unverified")
                  .map((t) => `- ${t.target}: ${t.reason ?? "unknown"}`)
                  .join("\n") +
                `\nReply with the same content and corrected citation tokens. End with the same trailing JSON block.`;
              const repair = await collectStreaming(this.opts.runner, forked.session, repairPrompt, o.signal ?? ctx.signal, (d) =>
                ctx.reportText(d),
              );
              usage.inputTokens += repair.usage.inputTokens;
              usage.cachedTokens += repair.usage.cachedTokens;
              usage.outputTokens += repair.usage.outputTokens;
              throwIfMcpRefusal(repair.text);
              finalText = repair.text;
              const second = this.parseAndValidate(o.reviewId, repair.text);
              finalCards = second.cards;
              finalData = second.data;
              finalValidation = second.validation;
            }
            ctx.reportUsage(usage);
            await this.recordUsage(o.reviewId, usage);
            await this.ingestTurn(o.reviewId, {
              sessionId: forked.session.id,
              ...(o.threadId ? { threadId: o.threadId } : {}),
              ...(o.conversationKey ? { conversationKey: o.conversationKey } : {}),
              ...(o.cardId ? { cardId: o.cardId } : {}),
              ...(o.hunkHash ? { hunkHash: o.hunkHash } : {}),
              data: finalData,
            });
            if (o.onPartial) {
              try {
                await o.onPartial(finalCards);
              } catch {
                // ignore
              }
            }
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
            void base;
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

  async runSmall(o: RunSmallOptions): Promise<RunInForkResult> {
    const settings = this.opts.settings.get();
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
      ...(o.threadId ? { threadId: o.threadId } : {}),
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
                usage.cachedTokens += repair.usage.cachedTokens;
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

  startReview(reviewId: string): void {
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
    this.enqueueReader(reviewId);
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
      jobIds.push(this.enqueueReader(reviewId).id);
    } else {
      if (stages.base !== "done") jobIds.push(...this.enqueueAfterReader(reviewId).map((j) => j.id));
      else {
        if (stages.critic !== "done") jobIds.push(...this.enqueueCritic(reviewId).map((j) => j.id));
        if (stages.concepts !== "done") jobIds.push(...this.enqueueConcepts(reviewId).map((j) => j.id));
        if (stages["hunk-pass"] !== "done") jobIds.push(...this.enqueueHunkPass(reviewId).map((j) => j.id));
        // Demo auto-fill is part of enqueueAfterReader, not a stage: a
        // restart after the base finished would otherwise leave pending
        // placeholders unfilled. No-op when nothing is pending.
        jobIds.push(...this.enqueueDemoFill(reviewId).map((j) => j.id));
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
    if (existing && existing.cards.length > 0 && existing.cards[0].blocks.length > 1) {
      return this.opts.jobs.enqueue({
        reviewId,
        kind: "concept",
        provider: this.opts.settings.get().main.provider,
        model: this.opts.settings.get().main.model,
        priority: JOB_PRIORITY.userRequested,
        run: async () => {},
      });
    }
    const settings = this.opts.settings.get();
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
        const { cards, data, validation } = this.parseAndValidate(reviewId, text);
        const title = (data?.["title"] as string | undefined) ?? existing?.title ?? slug;
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
              read: false,
              collapsed: false,
              revision: (page.cards[0]?.revision ?? 0) + 1,
              blocks: this.withValidation(
                reviewId,
                cards.flatMap((c) => c.blocks),
                validation,
              ),
              undoStack: [],
            },
          ];
        });
        await this.appendLog(reviewId, "new-card", { summary: `concept page ${slug}` }, { scope: "global" });
      },
    });
    return job;
  }

  summarizeHunk(reviewId: string, contentHash: string): Job | { reused: true; summary: string } {
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
    const settings = this.opts.settings.get();
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
          const hunkData = (data?.["hunk"] as { summary?: string; hiddenReason?: string | null } | undefined) ?? {};
          const summary = hunkData.summary ?? text.split("\n")[0].slice(0, 140);
          let hiddenReason = hunkData.hiddenReason ?? null;
          const live = this.opts.reviews.getSnapshot(reviewId);
          if (live && (this.isCitedByGuide(reviewId, contentHash) || this.isOneLineChange(live, contentHash))) {
            hiddenReason = null;
          }
          await this.opts.reviews.mutate(reviewId, (draft) => {
            let state = draft.hunkStates.find((s) => s.contentHash === contentHash);
            if (!state) {
              state = { contentHash, folded: false, reviewed: false };
              draft.hunkStates.push(state);
            }
            state.summary = summary;
            const fileHunk = draft.files.flatMap((f) => f.hunks).find((h) => h.contentHash === contentHash);
            if (fileHunk) {
              if (hiddenReason) fileHunk.hiddenReason = hiddenReason;
              else delete fileHunk.hiddenReason;
            }
          });
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
  ): { cards: ParsedCard[]; data: ReplyData | null; validation: ReturnType<typeof validateReply>; body: string } {
    const split = splitReply(text);
    // Malformed / non-object trailers are job-visible errors (reply-format
    // §10); a missing block is fine (many on-demand replies carry none).
    if (!split.ok && (split.error.kind === "malformed" || split.error.kind === "not-object")) {
      throw new Error(`trailing JSON ${split.error.kind}: ${split.error.message}`);
    }
    const body = split.body;
    const cards = parseCards(body);
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
    const settings = this.opts.settings.get();
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

  private async forkFor(reviewId: string): Promise<{ session: Session; viaFork: boolean }> {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) throw new Error(`unknown review ${reviewId}`);
    const settings = this.opts.settings.get();
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

  private enqueueReader(reviewId: string): Job {
    const settings = this.opts.settings.get();
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) throw new Error(`unknown review ${reviewId}`);
    const promptSnap = toPromptSnapshot(snapshot, { model: settings.main.model });
    const source = buildSourceBlurb(promptSnap);
    const diff = buildDiffSection(promptSnap, { inlineBudgetTokens: settings.inlineBudgetTokens });
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
                  if (!p.finished || streamed.has(index)) continue;
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
          const { cards, data, validation } = this.parseAndValidate(reviewId, buffer);
          let finalCards = cards;
          let finalData = data;
          let finalValidation = validation;
          if (validation.needsRepairTurn) {
            const repairPrompt =
              `Some citations in your previous reply could not be verified:\n` +
              validation.tokens
                .filter((t) => t.status === "unverified")
                .map((t) => `- ${t.target}: ${t.reason ?? "unknown"}`)
                .join("\n") +
              `\nReply with the same cards and corrected citation tokens. End with the same trailing JSON block.`;
            const repair = await collectStreaming(this.opts.runner, session, repairPrompt, ctx.signal, (d) =>
              ctx.reportText(d),
            );
            usage.inputTokens += repair.usage.inputTokens;
            usage.cachedTokens += repair.usage.cachedTokens;
            usage.outputTokens += repair.usage.outputTokens;
            ctx.reportUsage(repair.usage);
            throwIfMcpRefusal(repair.text);
            await this.recordUsage(reviewId, repair.usage);
            const second = this.parseAndValidate(reviewId, repair.text);
            finalCards = second.cards;
            finalData = second.data;
            finalValidation = second.validation;
          }
          await this.applyReaderResult(reviewId, finalCards, finalData, finalValidation);
          await this.ingestTurn(reviewId, { sessionId: session.id, data: finalData });
          this.setStage(reviewId, "reader", "done");
          this.enqueueAfterReader(reviewId);
        } catch (err) {
          this.setStage(reviewId, "reader", "error", (err as Error).message);
          throw err;
        } finally {
          try {
            await this.opts.runner.close(session);
          } catch {
            // ignore
          }
          // The reader session is closed: its MCP secret dies with it.
          this.opts.mcp.revokeSession(mcp.secret);
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
        root = { id: "root", kind: "root", title: "Guided review", saved: false, cards: [] };
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
          read: false,
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
    await this.opts.reviews.mutate(reviewId, (draft) => {
      let root = draft.pages.find((p) => p.id === "root");
      if (!root) {
        root = { id: "root", kind: "root", title: "Guided review", saved: false, cards: [] };
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
            read: false,
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
          read: false,
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
              read: false,
              collapsed: false,
              revision: 1,
              blocks: [{ type: "paragraph", id: "b1", text: { standard: c.summary }, citations: [] }],
              undoStack: [],
            },
          ],
        });
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

  private enqueueAfterReader(reviewId: string): Job[] {
    const out: Job[] = [];
    this.setStage(reviewId, "base", "running");
    out.push(...this.enqueueCritic(reviewId));
    out.push(...this.enqueueConcepts(reviewId));
    out.push(...this.enqueueHunkPass(reviewId));
    if (this.opts.reviews.getSnapshot(reviewId)?.review.repoId === "demo") {
      out.push(...this.enqueueDemoFill(reviewId));
    }
    return out;
  }

  private enqueueCritic(reviewId: string): Job[] {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return [];
    this.setStage(reviewId, "critic", "running");
    const settings = this.opts.settings.get();
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
            const { cards, data, validation } = this.parseAndValidate(reviewId, text);
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
                  read: false,
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
                payload: { summary: applied.title, unverified: validation.unverified },
                scope: { scope: "global" },
              });
            });
            await this.updateRestatedMapping(reviewId);
            await this.ingestTurn(reviewId, { sessionId: forked.session.id, data });
            this.maybeMarkStageDone(reviewId, "critic", 2);
          } catch (err) {
            this.setStage(reviewId, "critic", "error", (err as Error).message);
            throw err;
          }
        },
      });
    });
  }

  private enqueueConcepts(reviewId: string): Job[] {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return [];
    this.setStage(reviewId, "concepts", "running");
    const settings = this.opts.settings.get();
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
                    read: false,
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
        } catch (err) {
          this.setStage(reviewId, "concepts", "error", (err as Error).message);
          throw err;
        }
      },
    });
    return [job];
  }

  private enqueueHunkPass(reviewId: string): Job[] {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return [];
    this.setStage(reviewId, "hunk-pass", "running");
    const settings = this.opts.settings.get();
    const hunks = snapshot.files.flatMap((f) => f.hunks.map((h) => ({ file: f, hunk: h })));
    return hunks.map(({ file, hunk }) => {
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
        provider: settings.small.provider,
        model: settings.small.model,
        priority: JOB_PRIORITY.background,
        dedupe: { anchor: `hunk:${hunk.contentHash}`, requestKind: "hunk-pass", baseVersion: `v${snapshot.version.n}` },
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
            const hunkData = (data?.["hunk"] as { summary?: string; hiddenReason?: string | null } | undefined) ?? {};
            const summary = hunkData.summary ?? text.split("\n")[0].slice(0, 140);
            let hiddenReason = hunkData.hiddenReason ?? null;
            const live = this.opts.reviews.getSnapshot(reviewId);
            if (live && (this.isCitedByGuide(reviewId, hunk.contentHash) || this.isOneLineChange(live, hunk.contentHash))) {
              hiddenReason = null;
            }
            await this.opts.reviews.mutate(reviewId, (draft) => {
              let state = draft.hunkStates.find((s) => s.contentHash === hunk.contentHash);
              if (!state) {
                state = { contentHash: hunk.contentHash, folded: false, reviewed: false };
                draft.hunkStates.push(state);
              }
              state.summary = summary;
              const fh = draft.files.flatMap((f) => f.hunks).find((h) => h.contentHash === hunk.contentHash);
              if (fh) {
                if (hiddenReason) fh.hiddenReason = hiddenReason;
                else delete fh.hiddenReason;
              }
            });
            this.maybeMarkStageDone(reviewId, "hunk-pass", hunks.length);
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
    });
  }

  private enqueueDemoFill(reviewId: string): Job[] {
    const snapshot = this.opts.reviews.getSnapshot(reviewId);
    if (!snapshot) return [];
    const out: Job[] = [];
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
          provider: this.opts.settings.get().main.provider,
          model: this.opts.settings.get().main.model,
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
    const { cards, data, validation } = this.parseAndValidate(reviewId, text);
    const blocks = this.withValidation(
      reviewId,
      cards.flatMap((c) => c.blocks),
      validation,
    );
    const title = (data?.["title"] as string | undefined) ?? card.pending.label;
    await this.opts.reviews.mutate(reviewId, (draft) => {
      const r = draft.pages.find((p) => p.id === "root");
      const c = r?.cards.find((x) => x.id === cardId);
      if (!c) return;
      c.title = title;
      c.blocks = blocks;
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
    await this.ingestTurn(reviewId, { sessionId: forked.session.id, cardId, data });
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
    const { cards, data, validation } = this.parseAndValidate(reviewId, text);
    const title = (data?.["title"] as string | undefined) ?? existing?.title ?? slug;
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
          read: false,
          collapsed: false,
          revision: (page.cards[0]?.revision ?? 0) + 1,
          blocks: this.withValidation(
            reviewId,
            cards.flatMap((c) => c.blocks),
            validation,
          ),
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
        const t = draft.usageTotals ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0, createdAt: draft.review.createdAt };
        t.inputTokens += usage.inputTokens;
        t.cachedTokens += usage.cachedTokens;
        t.outputTokens += usage.outputTokens;
        // Read share (M0 pitfall #2): input counts uncached input only.
        t.cacheHitRate =
          t.inputTokens + t.cachedTokens > 0 ? t.cachedTokens / (t.inputTokens + t.cachedTokens) : undefined;
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
        cachedTokens: draft.usageTotals?.cachedTokens ?? 0,
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
        const settings = this.opts.settings.get();
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
