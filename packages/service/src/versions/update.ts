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
  FindingVerdict,
  Job,
  ReviewSnapshot,
  UpdatePassResult,
} from "@unvibe/shared";
import { JOB_PRIORITY } from "@unvibe/shared";
import type { JobQueue } from "../jobs/index.js";
import type { ReviewStore } from "../state/store.js";

export interface UpdateBaseRunner {
  runUpdatePrompt(
    prompt: string,
    opts: { reviewId: string; toVersion: number; signal?: AbortSignal },
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

/** Build the three `update_pass` variables from the current snapshot. */
export function buildUpdateVariables(snapshot: ReviewSnapshot): {
  changed_hunks: string;
  stale_cards: string;
  findings: string;
} {
  const status = snapshot.versionStatus;
  const changedNew = new Set(status?.changedNewIds ?? []);
  const chunks: string[] = [];
  for (const f of snapshot.files) {
    for (const h of f.hunks) {
      const id = `h:${f.fileKey}:${h.contentHash}`;
      const isChanged = changedNew.size === 0 ? (h as { stale?: boolean }).stale === true : changedNew.has(id);
      // When there is no versionStatus (fresh review), list nothing: the
      // update pass only runs after a refresh created a new version.
      if (status && (changedNew.has(id) || isChanged)) {
        chunks.push(formatChangedHunk(f.fileKey, f.path, h.contentHash, h.header, h.lines));
      } else if (!status) {
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
    changed_hunks: chunks.length > 0 ? chunks.join("\n\n") : "(no changed hunks)",
    stale_cards: staleCards.length > 0 ? staleCards.join("\n") : "(no stale cards)",
    findings: findings.length > 0 ? findings.join("\n") : "(no findings to recheck)",
  };
}

/** Render `prompts/update_pass.md` with the three variables. Pure I/O: reads one file. */
export function renderUpdatePrompt(promptsDir: string, vars: { changed_hunks: string; stale_cards: string; findings: string }): string {
  const raw = fs.readFileSync(path.join(promptsDir, "update_pass.md"), "utf8");
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  return body
    .replace("{{changed_hunks}}", vars.changed_hunks)
    .replace("{{stale_cards}}", vars.stale_cards)
    .replace("{{findings}}", vars.findings);
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
    if (blocks.length === 0) throw new Error("update pass: no trailing JSON block found");
    const raw = (blocks[blocks.length - 1][1] ?? "").trim();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`update pass: trailing JSON block does not parse: ${(err as Error).message}`);
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
        throw new Error(`update pass: bad finding verdict ${JSON.stringify(v)}`);
      }
    }
    return {
      revisedCards,
      recheckedFindings,
      newFindings,
      hunkSummaries,
      ...(droppedPins !== undefined ? { droppedPins } : {}),
    };
  }
}

/**
 * Apply an update-pass result in one mutate: revised cards (new revisions,
 * stale cleared), rechecked findings, new finding pages, regenerated hunk
 * summaries, and `versionStatus.stale` cleared.
 */
export async function applyUpdateResult(
  reviews: ReviewStore,
  reviewId: string,
  result: UpdatePassResult,
): Promise<void> {
  await reviews.mutate(reviewId, (draft) => {
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
        saved: false,
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
  if (!snapshot.versionStatus?.stale) throw new Error("review is up to date: no stale version to update");

  const promptsDir = resolveUpdatePromptsDir(deps.promptsDir);
  if (!promptsDir) throw new Error("update pass: no prompts dir (set UNVIBE_PROMPTS_DIR)");

  const provider = deps.provider ?? "main";
  const model = deps.model ?? "main-model";
  return deps.jobs.enqueue({
    reviewId: opts.reviewId,
    kind: "update-pass",
    provider,
    model,
    priority: JOB_PRIORITY.userRequested,
    dedupe: { anchor: "update", requestKind: "update-pass", baseVersion: `v${opts.toVersion}` },
    run: async (ctx) => {
      const vars = buildUpdateVariables(deps.reviews.getSnapshot(opts.reviewId) ?? snapshot);
      const prompt = renderUpdatePrompt(promptsDir, vars);
      ctx.setPromptSnapshot(prompt);
      const reply = await deps.baseRunner.runUpdatePrompt(prompt, {
        reviewId: opts.reviewId,
        toVersion: opts.toVersion,
        signal: ctx.signal,
      });
      ctx.reportText(reply.slice(0, 2000));
      const result = deps.parser.parseReply(reply);
      await applyUpdateResult(deps.reviews, opts.reviewId, result);
    },
  });
}
