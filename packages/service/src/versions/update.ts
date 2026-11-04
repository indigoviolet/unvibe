/**
 * Update pass (PRD §8.2): manual only, sees only changed + new hunks.
 *
 * Narrow dependencies (the base-building pipeline is another agent's):
 *
 * ```ts
 * interface UpdateBaseRunner {
 *   runUpdatePrompt(prompt: string, opts: { reviewId: string; toVersion: number; signal?: AbortSignal }): Promise<string>;
 * }
 * interface UpdateReplyParser { parseReply(text: string): UpdatePassResult; }
 * ```
 *
 * The route enqueues an `update-pass` job on the shared `JobQueue`; the job
 * renders `prompts/update_pass.md`, runs it via the injected base runner
 * (a fork of the new base), parses the trailing JSON block, and applies the
 * result in one `ReviewStore.mutate`: revised stale cards (new revisions),
 * rechecked findings, new findings for new code, regenerated hunk summaries.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  Block,
  Card,
  CardAddendumDraft,
  FindingVerdict,
  Job,
  Plotline,
  ReviewSnapshot,
  SinceHunks,
  TokenUsage,
  UpdatePassResult,
} from "@unvibe/shared";
import { isSinceBaseline, JOB_PRIORITY } from "@unvibe/shared";
import { formatSinceContext } from "./since.js";
import { resolveSinceBaseline } from "./since.js";
import {
  charTokenEstimator,
  countCodePoints,
  DEFAULT_BASE_PROMPT_CAP_TOKENS,
  DEFAULT_LEFTOVER_FLOOR_TOKENS,
} from "../context/tokens.js";
import type { JobQueue } from "../jobs/index.js";
import type { ReviewStore } from "../state/store.js";

/** Issue #194: live reporting hooks from the enclosing job, so a direct
 * (non-enqueued) update run still streams text, tools and usage. */
export interface UpdateRunHooks {
  setSessionId(id: string): void;
  reportText(delta: string): void;
  reportTool: import("../pipeline/runner.js").ToolCallback;
  reportUsage(usage: TokenUsage): void;
  setTurnPrompt?: (text: string) => void;
  reportTurnUsage?: (usage: TokenUsage, raw?: unknown) => void;
}

export interface UpdateBaseRunner {
  runUpdatePrompt(
    prompt: string,
    opts: { reviewId: string; toVersion: number; signal?: AbortSignal; hooks?: UpdateRunHooks },
  ): Promise<string>;
}

export interface UpdateReplyParser {
  parseReply(text: string): UpdatePassResult;
}

export interface UpdatePassDeps {
  jobs: JobQueue;
  reviews: ReviewStore;
  baseRunner: UpdateBaseRunner;
  parser: UpdateReplyParser;
  /** Defaults to `resolvePromptsDir()`; tests pass a fixture dir. */
  promptsDir?: string;
  provider?: string;
  model?: string;
  effort: string;
}

/** Format one hunk for the `{{changed_hunks}}` variable. */
export function formatChangedHunk(
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

/** Build the `update_pass` variables from the current snapshot. */
export function buildUpdateVariables(
  snapshot: ReviewSnapshot,
  opts: { capTokens?: number } = {},
): {
  changed_hunks: string;
  stale_cards: string;
  findings: string;
  since_context: string;
} {
  const status = snapshot.versionStatus;
  // Issue #351: the update pass explains B..head, not just the latest
  // refresh. `sinceHunks` (written on refresh and on baseline picks, by
  // hunk-content comparison) is the B..head set; without it fall back to
  // the refresh's latest-version set as before.
  const since = snapshot.sinceHunks;
  const changedNew = new Set(
    since ? [...since.added, ...since.changed] : (status?.changedNewIds ?? []),
  );
  const chunks: string[] = [];
  for (const f of snapshot.files) {
    for (const h of f.hunks) {
      const id = `h:${f.fileKey}:${h.contentHash}`;
      const isChanged = changedNew.size === 0 ? (h as { stale?: boolean }).stale === true : changedNew.has(id);
      // When there is no versionStatus (fresh review), list nothing: the
      // update pass only runs after a refresh created a new version.
      if ((status || since) && (changedNew.has(id) || isChanged)) {
        chunks.push(formatChangedHunk(f.fileKey, f.path, h.contentHash, h.header, h.lines));
      } else if (!status && !since) {
        continue;
      }
    }
  }
  // New hunks (added) are exactly the current hunks with no old counterpart:
  // without the old comparison we list every hunk the status marks new.
  // `changedNewIds` covers both changed and added on the new side when the
  // refresh wrote them; fall back to stale hunk states for robustness.
  if (status && chunks.length === 0) {
    const staleHashes = new Set(
      snapshot.hunkStates.filter((s) => s.stale === true).map((s) => s.contentHash),
    );
    for (const f of snapshot.files) {
      for (const h of f.hunks) {
        if (staleHashes.has(h.contentHash)) {
          chunks.push(formatChangedHunk(f.fileKey, f.path, h.contentHash, h.header, h.lines));
        }
      }
    }
  }

  const staleCards: string[] = [];
  for (const page of snapshot.pages) {
    for (const card of page.cards) {
      if (card.stale === true) {
        const n = card.staleChangedHunks ?? card.staleHunks?.length ?? 0;
        staleCards.push(`### ${card.title ?? "(untitled)"} [[card:${card.id}]] (${n} cited hunks changed)`);
      }
    }
  }
  const findings: string[] = [];
  for (const page of snapshot.pages) {
    if (page.kind !== "finding") continue;
    if (page.needsRecheck === true || page.recheckStatus === "pending") {
      findings.push(`### ${page.title} (${page.confidence ?? "unknown"}) [[page:${page.id}]] — recheck: ${page.summary ?? ""}`);
    }
  }
  return {
    changed_hunks: capChangedHunks(chunks, changedCap(staleCards, findings, opts.capTokens)),
    stale_cards: staleCards.length > 0 ? staleCards.join("\n") : "(no stale cards)",
    findings: findings.length > 0 ? findings.join("\n") : "(no findings to recheck)",
    since_context:
      since && (status || since.added.length > 0 || since.changed.length > 0)
        ? formatSinceContext(snapshot, since)
        : "(no baseline yet)",
  };
}

/**
 * What `{{changed_hunks}}` may spend (issue #107): the cap minus the other
 * two variables, with a floor so the counts line and its notice always
 * fit. The stale-cards/findings lists are tiny next to thousands of
 * hunks, so this is the full cap in practice; it only matters when they
 * are large.
 */
function changedCap(staleCards: string[], findings: string[], capTokens: number | undefined): number {
  const cap = capTokens ?? DEFAULT_BASE_PROMPT_CAP_TOKENS;
  const otherPoints = countCodePoints(staleCards.join("\n")) + countCodePoints(findings.join("\n"));
  const otherTokens = otherPoints === 0 ? 0 : Math.max(1, Math.ceil(otherPoints / 4));
  return Math.max(DEFAULT_LEFTOVER_FLOOR_TOKENS, cap - otherTokens);
}

/**
 * Cap the `{{changed_hunks}}` variable at the same hard cap as L1 (issue
 * #107): a refresh touching thousands of hunks must not overflow the
 * update prompt. Keeps the first chunks that fit, in input order, plus a
 * notice naming what was left out and how to reach it. Pure.
 */
function capChangedHunks(chunks: string[], capTokens: number): string {
  if (chunks.length === 0) return "(no changed hunks)";
  const full = chunks.join("\n\n");
  if (charTokenEstimator.estimateTokens(full) <= capTokens) return full;
  // Running code-point total: re-joining and re-estimating the whole kept
  // text per chunk is quadratic over thousands of chunks. The "\n\n"
  // separators contribute 2 code points each, so the probe below estimates
  // exactly what estimateTokens would return for the join — same kept
  // set, linear work.
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
  // The notice counts too: drop trailing chunks until text + notice fits.
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

/** Render `prompts/update_pass.md` with the update-pass variables. Pure I/O: reads one file. */
export function renderUpdatePrompt(
  promptsDir: string,
  vars: { changed_hunks: string; stale_cards: string; findings: string; since_context?: string },
): string {
  const raw = fs.readFileSync(path.join(promptsDir, "update_pass.md"), "utf8");
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  return body
    .replace("{{changed_hunks}}", vars.changed_hunks)
    .replace("{{stale_cards}}", vars.stale_cards)
    .replace("{{findings}}", vars.findings)
    .replace("{{since_context}}", vars.since_context ?? "(no baseline yet)");
}

export function resolveUpdatePromptsDir(explicit?: string): string | null {
  if (explicit) return explicit;
  const override = process.env.UNVIBE_PROMPTS_DIR;
  if (override && fs.existsSync(path.join(override, "update_pass.md"))) return override;
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, "prompts");
    if (fs.existsSync(path.join(candidate, "update_pass.md"))) return candidate;
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
export class JsonBlockReplyParser implements UpdateReplyParser {
  parseReply(text: string): UpdatePassResult {
    const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
    if (blocks.length === 0) throw new Error("the agent's reply was not in the expected format");
    const raw = (blocks[blocks.length - 1][1] ?? "").trim();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`the agent's reply was not in the expected format: trailing JSON block does not parse: ${(err as Error).message}`);
    }
    const revisedCards = Array.isArray(json["revisedCards"]) ? (json["revisedCards"] as UpdatePassResult["revisedCards"]) : [];
    const recheckedFindings = Array.isArray(json["recheckedFindings"])
      ? (json["recheckedFindings"] as UpdatePassResult["recheckedFindings"])
      : [];
    const newFindings = Array.isArray(json["newFindings"]) ? (json["newFindings"] as UpdatePassResult["newFindings"]) : [];
    const hunkSummaries =
      json["hunkSummaries"] && typeof json["hunkSummaries"] === "object"
        ? (json["hunkSummaries"] as Record<string, string>)
        : {};
    const droppedPins = Array.isArray(json["droppedPins"]) ? (json["droppedPins"] as string[]) : undefined;
    for (const r of recheckedFindings) {
      const v = (r as { verdict: string }).verdict as FindingVerdict;
      if (v !== "still-applies" && v !== "resolved" && v !== "changed") {
        throw new Error(`the agent's reply was not in the expected format: bad finding verdict ${JSON.stringify(v)}`);
      }
    }
    // Issue #351: explain-and-append fields. Malformed entries are
    // dropped, never applied half-way; verdicts above stay strict.
    const baseline = isSinceBaseline(json["baseline"]) ? json["baseline"] : undefined;
    const sinceHunks = normalizeSinceHunks(json["sinceHunks"]);
    const sinceCards = normalizeSinceCards(json["sinceSection"]);
    const addenda = normalizeAddenda(json["addenda"]);
    const plotlineAssignments = normalizePlotlineAssignments(json["plotlineAssignments"]);
    const newPlotlines = normalizeNewPlotlines(json["newPlotlines"]);
    return {
      revisedCards,
      recheckedFindings,
      newFindings,
      hunkSummaries,
      ...(droppedPins !== undefined ? { droppedPins } : {}),
      ...(baseline !== undefined ? { baseline } : {}),
      ...(sinceHunks !== undefined ? { sinceHunks } : {}),
      ...(sinceCards !== undefined ? { sinceSection: { cards: sinceCards } } : {}),
      ...(addenda !== undefined ? { addenda } : {}),
      ...(plotlineAssignments !== undefined ? { plotlineAssignments } : {}),
      ...(newPlotlines !== undefined ? { newPlotlines } : {}),
    };
  }
}

/** String arrays only; anything else is dropped. Pure. */
function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((e) => typeof e === "string")) return null;
  return [...v];
}

function normalizeSinceHunks(v: unknown): SinceHunks | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const added = stringArray(o["added"]) ?? [];
  const changed = stringArray(o["changed"]) ?? [];
  if (!Array.isArray(o["added"]) || !Array.isArray(o["changed"])) return undefined;
  return { added, changed };
}

function normalizeSinceCards(v: unknown): Card[] | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "object" || v === null) return undefined;
  const cards = (v as Record<string, unknown>)["cards"];
  if (!Array.isArray(cards)) return undefined;
  return cards.filter((c) => typeof c === "object" && c !== null) as Card[];
}

function normalizeAddenda(v: unknown): CardAddendumDraft[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: CardAddendumDraft[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o["cardId"] !== "string" || !Array.isArray(o["blocks"])) continue;
    out.push({ cardId: o["cardId"], blocks: o["blocks"] as Block[] });
  }
  return out.length > 0 ? out : undefined;
}

function normalizePlotlineAssignments(v: unknown): Record<string, string> | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "object" || v === null) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof k === "string" && typeof val === "string" && k.length > 0 && val.length > 0) out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeNewPlotlines(v: unknown): Plotline[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(
    (p): p is Plotline =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as Record<string, unknown>)["id"] === "string" &&
      typeof (p as Record<string, unknown>)["name"] === "string",
  );
  return out.length > 0 ? out : undefined;
}

/**
 * Apply an update-pass result in one mutate (issue #351: explain and
 * append): the dated Since-B section (replaced, never revised), dated
 * addenda appended to affected cards (old text unchanged), plotline
 * assignments for new hunks plus genuinely new plotlines (marked
 * `newSinceBaseline`), then as before revised cards, rechecked findings,
 * new findings, hunk summaries, and `versionStatus.stale` cleared.
 */
export async function applyUpdateResult(
  reviews: ReviewStore,
  reviewId: string,
  result: UpdatePassResult,
): Promise<void> {
  await reviews.mutate(reviewId, (draft) => {
    const toVersion = draft.review.currentVersion;
    const baselineV =
      result.baseline && isSinceBaseline(result.baseline)
        ? result.baseline.version
        : resolveSinceBaseline(draft).version;
    const now = Date.now();
    for (const rev of result.revisedCards) {
      for (const page of draft.pages) {
        const card = page.cards.find((c) => c.id === rev.cardId);
        if (!card) continue;
        card.undoStack.push({ blocks: card.blocks, level: card.level });
        card.blocks = rev.blocks as typeof card.blocks;
        card.revision = rev.revision > card.revision ? rev.revision : card.revision + 1;
        card.stale = false;
        delete card.staleChangedHunks;
        delete card.staleHunks;
      }
    }
    for (const rc of result.recheckedFindings) {
      const page = draft.pages.find((p) => p.id === rc.pageId);
      if (!page) continue;
      page.needsRecheck = false;
      page.recheckStatus = rc.verdict === "still-applies" ? "still-applies" : rc.verdict;
      if (rc.newSummary !== undefined) page.summary = rc.newSummary;
      if (rc.evidence !== undefined) page.recheckNote = rc.evidence;
      for (const card of page.cards) {
        card.stale = false;
        delete card.staleChangedHunks;
        delete card.staleHunks;
      }
    }
    for (const nf of result.newFindings) {
      if (draft.pages.some((p) => p.id === nf.pageId)) continue;
      draft.pages.push({
        id: nf.pageId,
        kind: "finding",
        title: nf.title,
        confidence: nf.confidence,
        summary: nf.summary,
        cards: nf.cards as ReviewSnapshot["pages"][number]["cards"],
      });
    }
    for (const [hash, summary] of Object.entries(result.hunkSummaries)) {
      const state = draft.hunkStates.find((s) => s.contentHash === hash);
      if (state) {
        state.summary = summary;
        state.needsSummary = false;
        state.stale = false;
      } else {
        draft.hunkStates.push({ contentHash: hash, folded: false, reviewed: false, summary });
      }
    }
    // Issue #351: append, don't rewrite. An addendum answers the delta for
    // its card, so the card leaves the stale set — while its old blocks
    // stay byte-for-byte as they were.
    for (const a of result.addenda ?? []) {
      for (const page of draft.pages) {
        const card = page.cards.find((c) => c.id === a.cardId);
        if (!card) continue;
        const addenda = (card.addenda ?? []) as NonNullable<typeof card.addenda>;
        addenda.push({
          id: `add-v${toVersion}-${addenda.length + 1}`,
          version: toVersion,
          baseline: baselineV,
          at: now,
          blocks: a.blocks as typeof addenda[number]["blocks"],
        });
        card.addenda = addenda;
        card.stale = false;
        delete card.staleChangedHunks;
        delete card.staleHunks;
      }
    }
    // The Since-B section is replaced whole on every pass, never revised.
    if (result.sinceSection && result.sinceSection.cards.length > 0) {
      const known = new Set(draft.pages.flatMap((p) => p.cards.map((c) => c.id)));
      if (draft.sinceSection) {
        for (const c of draft.sinceSection.cards) known.add(c.id);
      }
      const cards = result.sinceSection.cards.map((c, i) => {
        let id = typeof c.id === "string" && c.id.length > 0 ? c.id : `since-${toVersion}-${i + 1}`;
        if (known.has(id)) id = `${id}-v${toVersion}`;
        known.add(id);
        return { ...c, id, pageId: typeof c.pageId === "string" && c.pageId.length > 0 ? c.pageId : "since" };
      });
      draft.sinceSection = { baseline: baselineV, headVersion: toVersion, at: now, cards };
    }
    // New plotline threads first, so assignments below can target them.
    // Unknown assignment targets stay "other" (never invented ids).
    if (result.newPlotlines && result.newPlotlines.length > 0) {
      const known = new Set((draft.plotlines ?? []).map((p) => p.id));
      for (const p of result.newPlotlines) {
        if (known.has(p.id)) continue;
        known.add(p.id);
        draft.plotlines = [...(draft.plotlines ?? []), { ...p, newSinceBaseline: true }];
      }
    }
    if (result.plotlineAssignments) {
      const known = new Set((draft.plotlines ?? []).map((p) => p.id));
      for (const [hash, plotlineId] of Object.entries(result.plotlineAssignments)) {
        if (!known.has(plotlineId)) continue;
        const state = draft.hunkStates.find((s) => s.contentHash === hash);
        if (state) {
          state.plotline = plotlineId;
        } else {
          draft.hunkStates.push({ contentHash: hash, folded: false, reviewed: false, plotline: plotlineId });
        }
      }
    }
    if (result.sinceHunks) {
      const clean = (ids: unknown): string[] =>
        Array.isArray(ids) ? ids.filter((e): e is string => typeof e === "string") : [];
      draft.sinceHunks = { added: clean(result.sinceHunks.added), changed: clean(result.sinceHunks.changed) };
    }
    draft.sinceBaseline = { kind: "version", version: baselineV };
    if (draft.versionStatus) draft.versionStatus = { ...draft.versionStatus, stale: false };
    const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
    draft.logTail.push({
      seq,
      kind: "update-pass",
      payload: {
        revised: result.revisedCards.length,
        rechecked: result.recheckedFindings.length,
        newFindings: result.newFindings.length,
        summaries: Object.keys(result.hunkSummaries).length,
        sinceAdded: result.sinceHunks?.added.length ?? 0,
        sinceChanged: result.sinceHunks?.changed.length ?? 0,
        addenda: result.addenda?.length ?? 0,
      },
      scope: { scope: "global" },
    });
  });
}

/**
 * Enqueue the update pass as an `update-pass` job. Resolves with the job;
 * the job's `run` renders the prompt, calls the base runner, parses, and
 * applies. Rejects synchronously when there is nothing stale to update.
 */
export function enqueueUpdatePass(
  deps: UpdatePassDeps,
  opts: { reviewId: string; toVersion: number },
): Job {
  const snapshot = deps.reviews.getSnapshot(opts.reviewId);
  if (!snapshot) throw new Error(`unknown review ${opts.reviewId}`);
  if (!snapshot.versionStatus?.stale) throw new Error("this review is already up to date");

  const promptsDir = resolveUpdatePromptsDir(deps.promptsDir);
  if (!promptsDir) throw new Error("update pass: no prompts dir (set UNVIBE_PROMPTS_DIR)");

  const provider = deps.provider ?? "main";
  const model = deps.model ?? "main-model";
  const effort = deps.effort;
  return deps.jobs.enqueue({
    reviewId: opts.reviewId,
    kind: "update-pass",
    provider,
    model,
    effort,
    priority: JOB_PRIORITY.userRequested,
    dedupe: { anchor: "update", requestKind: "update-pass", baseVersion: `v${opts.toVersion}` },
    run: async (ctx) => {
      const vars = buildUpdateVariables(deps.reviews.getSnapshot(opts.reviewId) ?? snapshot);
      const prompt = renderUpdatePrompt(promptsDir, vars);
      ctx.setPromptSnapshot(prompt);
      // Issue #194: the runner executes directly in this job (no nested
      // enqueue — that deadlocked on this job's own dedupe key and sat
      // RUNNING with no token counts). Hooks stream its progress here.
      ctx.beginTurn("update");
      let reply: string;
      try {
        reply = await deps.baseRunner.runUpdatePrompt(prompt, {
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
      await applyUpdateResult(deps.reviews, opts.reviewId, result);
    },
  });
}
