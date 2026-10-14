/**
 * Shared-context service (PRD §9.3–§9.5): the live-pipeline wiring.
 *
 * - Handles `recordInteraction` events: taxonomy → append-only log
 *   (`snapshot.logTail`, durable in SQLite).
 * - Serves filtered change lists per conversation; the cursor advances only
 *   when the turn succeeds (`noteTurnSuccess`).
 * - Grows the base by appending log batches as new turns once `logBatchTokens`
 *   (settings) accumulate.
 * - Rebuilds the base via `planRebuild` (new version/guide, cache expiry
 *   from last-use time vs `cacheLifetimeMs`, superseded/appened thresholds);
 *   the small model merges contributions through the `consolidate` template.
 * - Corrections accept (new card revision, undoable) / dismiss; deleting a
 *   shared item writes the one-line deletion entry.
 * - Observes per-base stats for the jobs API.
 *
 * Small-model work (thread summaries, consolidation) arrives through
 * injected callbacks so this module never imports the pipeline (the pipeline
 * imports it instead — see `pipeline/sharedctx-wire.ts`).
 */
import type {
  Contribution,
  LogEntry,
  ReviewSnapshot,
  SharedContextBaseStats,
} from "@unvibe/shared";
import { filterChangeList, formatChangeList } from "../context/log.js";
import { formatLogEntry } from "../context/log.js";
import { charTokenEstimator } from "../context/tokens.js";
import { guideRevisionForSnapshot } from "../routes/prompts.js";
import { baseKeyString } from "../sessions/manager.js";
import type { SessionManager } from "../sessions/manager.js";
import type { SettingsStore } from "../settings/index.js";
import { resolveEffectiveSettings } from "../settings/index.js";
import type { ModelCatalog } from "../settings/index.js";
import type { ReviewStore } from "../state/store.js";
import type { Clock } from "../jobs/clock.js";
import { RealClock } from "../jobs/clock.js";
import { logEntryForEvent } from "./taxonomy.js";
import type { InteractionEvent } from "./hooks.js";
import { planGrowth, forceBatches, renderBatchTurn } from "./growth.js";
import { planRebuild } from "./rebuild.js";
import { applyConsolidation, formatContributionLines } from "./contributions.js";
import { isThreadSettled, summarizeSettledThread, toThreadSnapshot, type ThreadSnapshot } from "./threads.js";
import { SharedContextStore } from "./store.js";

export interface SharedContextDeps {
  reviews: ReviewStore;
  sessions: SessionManager;
  settings: SettingsStore;
  /** Model catalog for live role defaults (issue #88): base keys use the same effective settings as GET /api/settings. Absent → stored settings stand. */
  models?: ModelCatalog | null;
  store: SharedContextStore;
  clock?: Clock;
  /** Small-model consolidation for base rebuilds (`consolidate` template). */
  runConsolidate?: (
    reviewId: string,
    contributionsText: string,
  ) => Promise<{ kept: { id: string }[]; dropped: { id: string; why: string }[] }>;
  /** Small-model one-line thread summaries. */
  summarizeThreadSmall?: (threadText: string) => Promise<string>;
}

export class SharedContextService {
  private readonly clock: Clock;

  constructor(private readonly deps: SharedContextDeps) {
    this.clock = deps.clock ?? new RealClock();
  }

  // -- interaction hook ------------------------------------------------

  /** Real `recordInteraction` handler: taxonomy → durable log append. */
  async handleInteraction(event: InteractionEvent): Promise<void> {
    const mapped = logEntryForEvent(event);
    if (!mapped) return;
    await this.appendLog(event.reviewId, mapped.kind, mapped.payload, mapped.scope);
  }

  // -- log ---------------------------------------------------------------

  async appendLog(
    reviewId: string,
    kind: string,
    payload: unknown,
    scope: LogEntry["scope"],
  ): Promise<LogEntry | null> {
    try {
      const res = await this.deps.reviews.mutate(reviewId, (draft) => {
        const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
        draft.logTail.push({ seq, kind, payload, scope });
      });
      const added = res.snapshot.logTail[res.snapshot.logTail.length - 1];
      return added ?? null;
    } catch {
      return null;
    }
  }

  private snapshot(reviewId: string): ReviewSnapshot | null {
    return this.deps.reviews.getSnapshot(reviewId);
  }

  private maxSeq(reviewId: string): number {
    const snap = this.snapshot(reviewId);
    if (!snap) return 0;
    return snap.logTail.reduce((m, e) => Math.max(m, e.seq), 0);
  }

  // -- change lists ------------------------------------------------------

  /**
   * Filtered change list for a conversation's next turn: global entries plus
   * local ones for its card or hunk, after its cursor. New conversations
   * start at the base's log seq, so batches already in the base never repeat
   * and batches appended after the fork arrive here instead.
   */
  changeListFor(
    reviewId: string,
    opts: { conversationKey?: string; cardId?: string; hunkHash?: string; baseLogSeq?: number } = {},
  ): { entries: LogEntry[]; text: string; lastSeenSeq: number } {
    const snap = this.snapshot(reviewId);
    if (!snap) return { entries: [], text: formatChangeList([]), lastSeenSeq: 0 };
    let lastSeen = opts.baseLogSeq ?? 0;
    let cardId = opts.cardId;
    let hunkHash = opts.hunkHash;
    if (opts.conversationKey) {
      const cursor = this.deps.store.getCursor(opts.conversationKey);
      if (cursor.lastSeenSeq > 0 || cursor.cardId !== undefined || cursor.hunkHash !== undefined) {
        lastSeen = cursor.lastSeenSeq;
        cardId = cursor.cardId ?? cardId;
        hunkHash = cursor.hunkHash ?? hunkHash;
      } else {
        this.deps.store.seedCursor(opts.conversationKey, lastSeen, {
          ...(cardId ? { cardId } : {}),
          ...(hunkHash ? { hunkHash } : {}),
          now: this.clock.now(),
        });
      }
    }
    const entries = filterChangeList(snap.logTail, {
      lastSeenSeq: lastSeen,
      ...(cardId ? { cardId } : {}),
      ...(hunkHash ? { hunkHash } : {}),
    });
    return { entries, text: formatChangeList(entries), lastSeenSeq: lastSeen };
  }

  /**
   * Advance the conversation cursor after a turn succeeds. Failed turns must
   * not call this — the next turn then retries the same change list.
   */
  noteTurnSuccess(
    reviewId: string,
    opts: { conversationKey?: string; sessionId?: string } = {},
  ): number {
    const max = this.maxSeq(reviewId);
    if (opts.conversationKey) {
      this.deps.store.advanceCursor(opts.conversationKey, max, { now: this.clock.now() });
    }
    if (opts.sessionId) {
      try {
        this.deps.sessions.markSeen(opts.sessionId, max);
      } catch {
        // Session unknown (pipeline forks bypass the manager): cursor is enough.
      }
    }
    return max;
  }

  // -- base growth ---------------------------------------------------------

  private async effectiveSettings() {
    return resolveEffectiveSettings({ settings: this.deps.settings, models: this.deps.models ?? null });
  }

  private async baseKeyFor(reviewId: string): Promise<string | null> {
    const snap = this.snapshot(reviewId);
    if (!snap) return null;
    const settings = await this.effectiveSettings();
    return baseKeyString({
      reviewId,
      reviewVersion: `v${snap.version.n}`,
      guideRevision: guideRevisionForSnapshot(snap),
      provider: settings.main.provider,
      model: settings.main.model,
      effort: settings.main.effort,
    });
  }

  /**
   * Append ready log batches to the base session as new turns. `appendTurn`
   * sends one turn on the live base (wired to
   * `sessions.appendLogBatch` by the pipeline). Returns appended batches.
   */
  async maybeGrowBase(
    reviewId: string,
    appendTurn: (baseKey: string, batch: { seq: number; text: string }) => Promise<void>,
    opts: { force?: boolean } = {},
  ): Promise<{ appended: number; pendingTokens: number }> {
    const snap = this.snapshot(reviewId);
    const baseKey = await this.baseKeyFor(reviewId);
    if (!snap || !baseKey) return { appended: 0, pendingTokens: 0 };
    const info = this.deps.sessions.baseInfo(baseKey);
    const through = info?.logSeq ?? 0;
    const batchTokens = (await this.effectiveSettings()).logBatchTokens;
    const plan = opts.force
      ? { batches: forceBatches(snap.logTail, through, { batchTokens }), pending: [], pendingTokens: 0 }
      : planGrowth(snap.logTail, through, { batchTokens });
    let appended = 0;
    for (const batch of plan.batches) {
      const turn = renderBatchTurn(batch);
      await appendTurn(baseKey, turn);
      appended += 1;
    }
    if (appended > 0) {
      const addedTokens = plan.batches
        .flat()
        .reduce((n, e) => n + charTokenEstimator.estimateTokens(formatLogEntry(e)), 0);
      this.recordAppended(reviewId, baseKey, addedTokens);
    }
    return { appended, pendingTokens: plan.pendingTokens };
  }

  // -- rebuild ---------------------------------------------------------------

  /**
   * Check rebuild triggers for the review's current base. On rebuild the
   * small model merges contributions (duplicates removed, superseded
   * resolved, accepted corrections folded in — applied through
   * `applyConsolidation`), `onRebuild` builds the new base, and old bases
   * are pruned when unused. In-flight conversations on the old base keep
   * working: their sessions are never touched here.
   */
  async maybeRebuildBase(
    reviewId: string,
    opts: {
      /** Base under evaluation; defaults to the review's current base key. */
      baseKey?: string;
      onRebuild: (reasons: string[]) => Promise<{ newBaseKey: string; newBaseTokens: number }>;
      pruneBases?: (reviewId: string, keep: Set<string>) => Promise<void>;
    },
  ): Promise<{ rebuilt: boolean; reasons: string[] }> {
    const snap = this.snapshot(reviewId);
    const baseKey = opts.baseKey ?? (await this.baseKeyFor(reviewId));
    if (!snap || !baseKey) return { rebuilt: false, reasons: [] };
    const settings = await this.effectiveSettings();
    const info = this.deps.sessions.baseInfo(baseKey);
    const obs = this.deps.store.statsForReview(reviewId).find((s) => s.baseKey === baseKey);
    const baseTokens = obs?.baseTokens ?? 0;
    const appendedTokens = obs?.appendedTokens ?? 0;
    const supersededTokens =
      obs && obs.baseTokens > 0 ? obs.supersededRatio * obs.baseTokens : 0;
    const baseVersion = snap.version.n;
    // Guide revision is content-derived (guideRevisionForSnapshot): log
    // appends never move it, so the live base stays put while the log grows.
    const baseGuideRevision = baseKey.split("|")[2] ?? guideRevisionForSnapshot(snap);
    const plan = planRebuild({
      baseVersion: Number(baseKey.split("|")[1]?.slice(1) ?? baseVersion),
      baseGuideRevision,
      baseTokens,
      appendedTokens,
      supersededTokens,
      baseLastUsedAt: info?.lastUsedAt ?? 0,
      now: this.clock.now(),
      cacheLifetimeMs: settings.cacheLifetimeMs,
      currentVersion: snap.version.n,
      currentGuideRevision: guideRevisionForSnapshot(snap),
      thresholds: {
        rebuildSupersededRatio: settings.rebuildSupersededRatio,
        rebuildAppendedTokens: settings.rebuildAppendedTokens,
      },
    });
    if (!plan.rebuild) return { rebuilt: false, reasons: [] };

    if (this.deps.runConsolidate && snap.contributions.length > 0) {
      const text = formatContributionLines(snap.contributions);
      try {
        const verdict = await this.deps.runConsolidate(reviewId, text);
        const { merged, droppedIds } = applyConsolidation(snap.contributions, verdict);
        const retiredTokens = snap.contributions
          .filter((c) => droppedIds.includes(c.id))
          .reduce((n, c) => n + charTokenEstimator.estimateTokens(JSON.stringify(c.items)), 0);
        await this.deps.reviews.mutate(reviewId, (draft) => {
          draft.contributions = merged;
          const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
          draft.logTail.push({
            seq,
            kind: "update-note",
            payload: { summary: `base rebuilt (${plan.reasons.join(", ")}): consolidated ${merged.length} contributions` },
            scope: { scope: "global" },
          });
        });
        void retiredTokens;
        if (retiredTokens > 0) {
          const cur = this.deps.store.statsForReview(reviewId).find((s) => s.baseKey === baseKey);
          if (cur) {
            this.deps.store.observe({
              reviewId,
              baseKey,
              baseTokens: cur.baseTokens,
              appendedTokens: cur.appendedTokens,
              supersededTokens: cur.supersededRatio * cur.baseTokens + retiredTokens,
              lastRebuildReason: cur.lastRebuildReason,
              lastUsedAt: cur.lastUsedAt,
            });
          }
        }
      } catch {
        // Consolidation is best-effort: rebuild the base anyway.
      }
    }

    const built = await opts.onRebuild(plan.reasons);
    this.deps.store.observe({
      reviewId,
      baseKey: built.newBaseKey,
      baseTokens: built.newBaseTokens,
      appendedTokens: 0,
      supersededTokens: 0,
      lastRebuildReason: plan.reasons.join(","),
      lastUsedAt: this.clock.now(),
    });
    if (opts.pruneBases) {
      await opts.pruneBases(reviewId, new Set([built.newBaseKey]));
    }
    return { rebuilt: true, reasons: [...plan.reasons] };
  }

  // -- settled threads ---------------------------------------------------------

  /**
   * Settle check for one comment or conversation card: closed, or idle
   * past the threshold. Settled summaries are logged (one line) via the
   * interaction path so other conversations see them in their change
   * lists. Cards settle their turns as reader/agent pairs (#136).
   */
  async maybeSettleThread(
    reviewId: string,
    commentId: string,
    opts: { now?: number; settleAfterMs?: number; lastActivityAt?: number } = {},
  ): Promise<{ settled: boolean; summary?: string }> {
    const snap = this.snapshot(reviewId);
    const thread = snap?.annotations.find((a) => a.id === commentId);
    if (!snap || !thread || (thread.type !== "comment" && thread.type !== "conversation")) {
      return { settled: false };
    }
    const now = opts.now ?? this.clock.now();
    const lastActivity = opts.lastActivityAt ?? threadLastActivity(thread, now);
    const snapThread: ThreadSnapshot = toThreadSnapshot(thread, lastActivity);
    if (!isThreadSettled(snapThread, now, opts.settleAfterMs)) return { settled: false };
    const summary = await summarizeSettledThread(snapThread, this.deps.summarizeThreadSmall);
    if (!summary) return { settled: false };
    // One line, once: skip when this thread already has a summary entry.
    const already = snap.logTail.some(
      (e) =>
        e.kind === "thread-summary" &&
        e.payload !== null &&
        typeof e.payload === "object" &&
        (e.payload as Record<string, unknown>).annotationId === commentId,
    );
    if (already) return { settled: true, summary };
    const host = thread.anchor.host;
    await this.appendLog(
      reviewId,
      "thread-summary",
      { summary, annotationId: commentId },
      { scope: "global" },
    );
    void host;
    return { settled: true, summary };
  }

  // -- corrections ---------------------------------------------------------------

  private findContribution(snap: ReviewSnapshot, id: string): Contribution | undefined {
    return snap.contributions.find((c) => c.id === id);
  }

  private correctionTarget(c: Contribution): { cardId: string; blockId: string } | null {
    const corr = c.items.find((i) => i.kind === "correction" && i.target);
    if (!corr?.target) return null;
    const m = /^card:([^#]+)#([^#]+)$/.exec(corr.target);
    if (!m) return null;
    return { cardId: m[1], blockId: m[2] };
  }

  /**
   * Accept a pending correction: new card revision (undoable), contribution
   * marked accepted. Throws coded errors: `unknown-review`,
   * `unknown-contribution`, `not-pending-correction`, `unknown-card`.
   */
  async acceptContribution(reviewId: string, contributionId: string): Promise<{ cardId: string; revision: number }> {
    const snap = this.snapshot(reviewId);
    if (!snap) throw codedError("unknown-review", `unknown review ${reviewId}`);
    const c = this.findContribution(snap, contributionId);
    if (!c) throw codedError("unknown-contribution", `unknown contribution ${contributionId}`);
    if (c.status !== "pending") throw codedError("not-pending-correction", `contribution ${contributionId} is ${c.status}`);
    const target = this.correctionTarget(c);
    if (!target) throw codedError("not-pending-correction", `contribution ${contributionId} carries no correction`);
    const corr = c.items.find((i) => i.kind === "correction")!;
    let revision = 0;
    await this.deps.reviews.mutate(reviewId, (draft) => {
      const card = draft.pages.flatMap((p) => p.cards).find((x) => x.id === target.cardId);
      if (!card) throw codedError("unknown-card", `unknown card ${target.cardId}`);
      // JSON round-trip (not structuredClone: drafts are Immer proxies,
      // which structuredClone refuses to clone).
      card.undoStack.push({ blocks: JSON.parse(JSON.stringify(card.blocks)), level: card.level });
      const n = card.blocks.length + 1;
      card.blocks.push({
        type: "paragraph",
        id: `b-corr-${contributionId}`,
        text: { standard: `Accepted suggestion (from ${contributionId}): ${corr.text}` },
        citations: corr.citations.map((cit) => ({ target: cit.target })),
      });
      void n;
      card.revision += 1;
      revision = card.revision;
      const stored = draft.contributions.find((x) => x.id === contributionId);
      if (stored) stored.status = "accepted";
    });
    if (revision === 0) throw codedError("unknown-card", `unknown card ${target.cardId}`);
    return { cardId: target.cardId, revision };
  }

  /** Dismiss a pending correction. Same coded errors as accept. */
  async dismissContribution(reviewId: string, contributionId: string): Promise<{ dismissedId: string }> {
    const snap = this.snapshot(reviewId);
    if (!snap) throw codedError("unknown-review", `unknown review ${reviewId}`);
    const c = this.findContribution(snap, contributionId);
    if (!c) throw codedError("unknown-contribution", `unknown contribution ${contributionId}`);
    if (c.status !== "pending") throw codedError("not-pending-correction", `contribution ${contributionId} is ${c.status}`);
    await this.deps.reviews.mutate(reviewId, (draft) => {
      const stored = draft.contributions.find((x) => x.id === contributionId);
      if (stored) stored.status = "dismissed";
    });
    return { dismissedId: contributionId };
  }

  /**
   * Delete a shared contribution. Deleting an item that had been shared
   * writes the one-line deletion entry (PRD §9.3).
   */
  async deleteContribution(reviewId: string, contributionId: string): Promise<{ deletedId: string }> {
    const snap = this.snapshot(reviewId);
    if (!snap) throw codedError("unknown-review", `unknown review ${reviewId}`);
    if (!snap.contributions.some((c) => c.id === contributionId)) {
      throw codedError("unknown-contribution", `unknown contribution ${contributionId}`);
    }
    await this.deps.reviews.mutate(reviewId, (draft) => {
      draft.contributions = draft.contributions.filter((c) => c.id !== contributionId);
      const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
      draft.logTail.push({
        seq,
        kind: "deletion",
        payload: { summary: `contribution ${contributionId} deleted` },
        scope: { scope: "global" },
      });
    });
    return { deletedId: contributionId };
  }

  // -- observability ---------------------------------------------------------

  /** Record a freshly built base (size + timestamp; resets counters). */
  noteBaseBuilt(reviewId: string, baseKey: string, baseTokens: number): void {
    this.deps.store.observe({
      reviewId,
      baseKey,
      baseTokens,
      appendedTokens: 0,
      supersededTokens: 0,
      lastRebuildReason: null,
      lastUsedAt: this.clock.now(),
    });
  }

  private recordAppended(reviewId: string, baseKey: string, tokens: number): void {
    const current = this.deps.store.statsForReview(reviewId).find((s) => s.baseKey === baseKey);
    this.deps.store.observe({
      reviewId,
      baseKey,
      baseTokens: current?.baseTokens ?? 0,
      appendedTokens: (current?.appendedTokens ?? 0) + tokens,
      supersededTokens: current ? current.supersededRatio * current.baseTokens : 0,
      lastRebuildReason: current?.lastRebuildReason ?? null,
      lastUsedAt: this.clock.now(),
    });
  }

  /** Per-base stats for the jobs API, with the review's cache-hit rate. */
  statsForReview(reviewId: string): SharedContextBaseStats[] {
    const snap = this.snapshot(reviewId);
    const stats = this.deps.store.statsForReview(reviewId);
    const rate = snap?.usageTotals?.cacheHitRate;
    const infoByKey = new Map<string, number>();
    for (const s of stats) {
      const info = this.deps.sessions.baseInfo(s.baseKey);
      if (info) infoByKey.set(s.baseKey, info.lastUsedAt);
    }
    return stats.map((s) => ({
      ...s,
      ...(rate !== undefined ? { cacheHitRate: rate } : {}),
      ...(infoByKey.get(s.baseKey) !== undefined ? { lastUsedAt: infoByKey.get(s.baseKey)! } : {}),
    }));
  }
}

export function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function threadLastActivity(thread: ReviewSnapshot["annotations"][number], now: number): number {
  // Annotations carry no timestamps; callers with real clocks pass
  // `lastActivityAt` explicitly. Default: now (never idle-settles by age —
  // only closed threads settle).
  void thread;
  return now;
}
