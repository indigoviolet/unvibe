/**
 * Automatic contributions (PRD §9.5).
 *
 * After each agent turn the trailing `contribute` block is processed:
 * - `facts` need citations: every citation must validate (valid or repaired
 *   through the review lookup); facts without a valid citation are dropped;
 * - duplicates are dropped: same normalised text + same citations (after
 *   repair canonicalisation), and anything already in the session's context
 *   (guide text the session saw);
 * - `replaces` retires the named earlier contribution (status `merged`);
 * - at most 3 items per turn are kept (PRD "1–3 items");
 * - the survivors are appended to the log labelled with their source
 *   session/thread, and stored in the snapshot.
 *
 * Corrections target `card:…#block` and are stored `pending`: the user
 * accepts (new card revision, undoable) or dismisses. Nothing is rewritten
 * silently — this module never touches card blocks.
 */
import type { Citation, Contribution, ContributionItem, LogEntry, ReplyData } from "@unvibe/shared";
import { canonicalizeTarget } from "@unvibe/shared";
import type { ReviewLookup } from "../validate/lookup.js";
import { validateTarget } from "../validate/validate.js";

export const MAX_CONTRIBUTION_ITEMS = 3;

export interface ContributeInput {
  reviewId: string;
  sessionId: string;
  annotationId?: string;
  contribute: NonNullable<ReplyData["contribute"]>;
  /** Text the session already saw (L1+L2+change list); matches dedupe here. */
  contextText: string;
  /** Existing contributions in the snapshot (for dedupe + replaces). */
  existing: Contribution[];
  /** Next contribution id (caller owns id allocation, e.g. `ct_<n>`). */
  nextId: string;
}

export interface ContributeOutcome {
  /** Contributions to store in the snapshot. */
  kept: Contribution[];
  /** Human-readable reasons for everything dropped. */
  dropped: { text: string; why: string }[];
  /** Ids retired through `replaces` (status → `merged`). */
  supersededIds: string[];
  /** Log entries to append (labelled with source session/thread). */
  logEntries: { kind: string; payload: unknown; scope: LogEntry["scope"] }[];
}

/** Normalise contribution text for duplicate comparison. */
export function normalizeContributionText(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Canonical citation key: repaired targets collapse to their fix. */
function citationKey(citations: Citation[], lookup: ReviewLookup): string {
  const resolve = (key: string): string | null => lookup.resolveFileKey(key);
  const keys: string[] = [];
  for (const c of citations) {
    const report = validateTarget(c.target, lookup);
    if (report.status === "repaired" && report.repairedTo) keys.push(canonicalizeTarget(report.repairedTo, resolve));
    else keys.push(canonicalizeTarget(c.target, resolve));
  }
  return [...new Set(keys)].sort().join("|");
}

/**
 * Validate one citation target: true when the ID exists (valid) or repairs
 * unambiguously to one that does. Unknown concepts are valid candidates —
 * but a *fact* may not rest on a concept slug alone (it cites no code), so
 * callers treat `concept:` citations as insufficient for facts.
 */
export function isUsableCitation(target: string, lookup: ReviewLookup): boolean {
  const report = validateTarget(target, lookup);
  return report.status === "valid" || report.status === "repaired";
}

function openQuestionsOf(contribute: NonNullable<ReplyData["contribute"]>): string[] {
  const out: string[] = [];
  for (const q of contribute.open_questions ?? []) {
    if (typeof q === "string") out.push(q);
    else if (q && typeof q === "object" && typeof q.text === "string") out.push(q.text);
  }
  return out;
}

function readerNotesOf(contribute: NonNullable<ReplyData["contribute"]>): string[] {
  const out: string[] = [];
  for (const n of contribute.reader_notes ?? []) {
    if (typeof n === "string") out.push(n);
    else if (n && typeof n === "object" && typeof n.text === "string") out.push(n.text);
  }
  return out;
}

interface CandidateItem extends ContributionItem {
  origin: string;
}

/**
 * Process one turn's `contribute` block. Pure: no I/O, no store. The caller
 * persists `kept` (snapshot.contributions), applies `supersededIds`, and
 * appends `logEntries`.
 */
export function processContribute(input: ContributeInput, lookup: ReviewLookup): ContributeOutcome {
  const dropped: { text: string; why: string }[] = [];
  const candidates: CandidateItem[] = [];
  const c = input.contribute;

  for (const f of c.facts ?? []) {
    const text = f.text ?? "";
    const citations = (f.citations ?? []).map((target) => ({ target }));
    const usable = citations.filter((cit) => isUsableCitation(cit.target, lookup));
    if (usable.length === 0) {
      dropped.push({ text, why: "fact without a valid citation" });
      continue;
    }
    candidates.push({ kind: "fact", text, citations: usable, origin: "fact" });
  }
  for (const corr of c.corrections ?? []) {
    const text = corr.text ?? "";
    const target = corr.target ?? "";
    if (!/^card:[^#]+#[^#]+$/.test(target)) {
      dropped.push({ text, why: "correction without a card:<id>#<block> target" });
      continue;
    }
    const citations = (corr.citations ?? []).map((t) => ({ target: t }));
    candidates.push({ kind: "correction", text, target, citations, origin: "correction" });
  }
  for (const q of openQuestionsOf(c)) {
    candidates.push({ kind: "open_question", text: q, citations: [], origin: "open_question" });
  }
  for (const n of readerNotesOf(c)) {
    candidates.push({ kind: "reader_note", text: n, citations: [], origin: "reader_note" });
  }

  const seenKeys = new Set<string>();
  for (const existing of input.existing) {
    for (const item of existing.items) {
      seenKeys.add(dedupeKey(item, lookup));
    }
  }
  const contextNorm = normalizeContributionText(input.contextText);

  const unique: CandidateItem[] = [];
  for (const item of candidates) {
    if (!normalizeContributionText(item.text)) {
      dropped.push({ text: item.text, why: "empty text" });
      continue;
    }
    const key = dedupeKey(item, lookup);
    if (seenKeys.has(key)) {
      dropped.push({ text: item.text, why: "duplicate of an earlier contribution" });
      continue;
    }
    if (contextNorm.includes(normalizeContributionText(item.text))) {
      dropped.push({ text: item.text, why: "already in the session's context" });
      continue;
    }
    seenKeys.add(key);
    unique.push(item);
  }

  const keptItems = unique.slice(0, MAX_CONTRIBUTION_ITEMS);
  for (const extra of unique.slice(MAX_CONTRIBUTION_ITEMS)) {
    dropped.push({ text: extra.text, why: `over the per-turn limit of ${MAX_CONTRIBUTION_ITEMS}` });
  }

  const kept: Contribution[] = [];
  const logEntries: ContributeOutcome["logEntries"] = [];
  if (keptItems.length > 0) {
    const contribution: Contribution = {
      id: input.nextId,
      sourceSession: input.sessionId,
      ...(input.annotationId ? { sourceThread: input.annotationId } : {}),
      items: keptItems.map((item) => ({
        kind: item.kind,
        text: item.text,
        ...(item.target ? { target: item.target } : {}),
        citations: item.citations,
      })),
      ...(typeof c.replaces === "string" && c.replaces ? { replaces: c.replaces } : {}),
      status: "pending",
    };
    kept.push(contribution);
    logEntries.push({
      kind: "contribution",
      payload: {
        contributionId: contribution.id,
        sourceSession: input.sessionId,
        ...(input.annotationId ? { sourceThread: input.annotationId } : {}),
        items: contribution.items.map((i) => ({ kind: i.kind, text: i.text })),
      },
      scope: { scope: "global" },
    });
  }

  const supersededIds: string[] = [];
  if (typeof c.replaces === "string" && c.replaces) {
    if (input.existing.some((e) => e.id === c.replaces)) supersededIds.push(c.replaces);
    else dropped.push({ text: c.replaces, why: "replaces an unknown contribution id" });
  }

  return { kept, dropped, supersededIds, logEntries };
}

function dedupeKey(item: ContributionItem, lookup: ReviewLookup): string {
  const text = normalizeContributionText(item.text);
  const cits = citationKey(item.citations, lookup);
  const target = item.target ?? "";
  return `${item.kind}|${text}|${cits}|${target}`;
}

/**
 * Merge contributions on a base rebuild (PRD §9.5, `consolidate` template):
 * the small model returns `{ kept: [{id…}], dropped: [{id, why…}] }`. This
 * applies that verdict: survivors (in ID order, unreworded) plus newly
 * accepted-correction folding reported by the caller.
 *
 * Pure: given the stored contributions and the model's verdict, return the
 * merged list. Unknown ids in the verdict are ignored.
 */
export function applyConsolidation(
  existing: Contribution[],
  verdict: { kept: { id: string }[]; dropped: { id: string; why: string }[] },
): { merged: Contribution[]; droppedIds: string[] } {
  const keepIds = new Set(verdict.kept.map((k) => k.id));
  const merged = existing.filter((c) => keepIds.has(c.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const droppedIds = verdict.dropped.map((d) => d.id).filter((id) => existing.some((c) => c.id === id));
  return { merged, droppedIds };
}

/**
 * One contribution as the consolidate model sees it (issue #80): the same
 * line the real call (`SharedContextService`, base rebuilds) sends and the
 * Debug → Prompts preview renders, so the preview never shows text the
 * model never receives.
 */
export function formatContributionLine(c: Pick<Contribution, "id" | "status" | "replaces" | "items">): string {
  return `- ${c.id} [${c.status}] replaces=${c.replaces ?? "-"}: ${c.items.map((i) => `[${i.kind}] ${i.text}`).join(" / ")}`;
}

/** Every contribution for the consolidate call, one per line. */
export function formatContributionLines(cs: Pick<Contribution, "id" | "status" | "replaces" | "items">[]): string {
  return cs.map(formatContributionLine).join("\n");
}
