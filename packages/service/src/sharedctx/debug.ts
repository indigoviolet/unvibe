/**
 * Per-review shared-context debug document (issue #32, PRD §9).
 *
 * Pure Markdown builders for `GET /api/reviews/:id/shared-context`. The
 * page renders the three strings as-is; the web side does no formatting of
 * its own beyond rendering Markdown and plain section headings. Prefer the
 * text the agents actually receive: log lines reuse `formatLogEntry`, and
 * the base pack is the `buildBasePack` output (shown in fenced blocks so
 * diff/code lines are never mangled by the Markdown renderer).
 *
 * No behaviour change: nothing here decides what enters the log, rebuild
 * rules, or contribution validation — it only renders existing state.
 */
import type { Contribution, LogEntry, SharedContextBaseStats } from "@unvibe/shared";
import { formatLogEntry } from "../context/log.js";
import { planGrowth } from "./growth.js";

/**
 * Fence `text` for a Markdown code block. The delimiter grows past any
 * backtick run inside the text (the base pack itself contains fenced
 * blocks), so the exact bytes stay readable.
 */
export function fence(text: string, info = "text"): string {
  let ticks = 3;
  for (const m of text.matchAll(/`{3,}/g)) {
    ticks = Math.max(ticks, m[0].length + 1);
  }
  const fence = "`".repeat(ticks);
  return `${fence}${info}\n${text}\n${fence}`;
}

/** Parsed view of a session-manager base key (`version|guideRevision|provider|model`). */
export function parseBaseKey(baseKey: string): {
  version: string;
  guideRevision: string;
  provider: string;
  model: string;
} {
  const [version = "?", guideRevision = "?", provider = "?", ...modelRest] = baseKey.split("|");
  return { version, guideRevision, provider, model: modelRest.join("|") || "?" };
}

// --- base ------------------------------------------------------------------

export interface BaseSectionInput {
  /** Per-base observability rows, if any bases have been built. */
  stats: SharedContextBaseStats[];
  /** Base key the pack below was built for (current version/guide/model). */
  currentKey: string;
  /** True when a base is known (stats row or live session). */
  hasBase: boolean;
  /** L0 system text the base is started with. */
  system: string;
  /** L1 + L1b + L2 user text sent on the base session. */
  pack: string;
  /** Token estimate of the pack. */
  packTokens: number;
  /** True when the L1 diff exceeded the inline budget (headers fallback). */
  overBudget: boolean;
  /** Set when the instructions template could not be loaded. */
  instructionsNote?: string;
}

/** Base section: one block per known base (key + stats), then the current pack fenced. */
export function buildBaseMarkdown(input: BaseSectionInput): string {
  const out: string[] = ["## Base", ""];
  if (input.stats.length === 0) {
    out.push(
      input.hasBase
        ? "A base session is live but has no recorded stats yet."
        : "No base has been built yet. The pack below is what would be sent.",
      "",
    );
  } else {
    out.push(
      `${input.stats.length} base${input.stats.length === 1 ? "" : "s"} built for this review. ` +
        "The pack below is the current pack — what would be sent now, not a historical rebuild.",
      "",
    );
    for (const s of input.stats) {
      const parsed = parseBaseKey(s.baseKey);
      out.push(
        `### Base \`${s.baseKey}\``,
        "",
        `- version: \`${parsed.version}\` · guide revision: \`${parsed.guideRevision}\` · provider/model: \`${parsed.provider}/${parsed.model}\``,
        `- base tokens: ${s.baseTokens}`,
        `- appended since build: ${s.appendedTokens}`,
        `- superseded: ${(s.supersededRatio * 100).toFixed(1)}%`,
        `- last rebuild: ${s.lastRebuildReason ?? "built fresh"}`,
        `- last used: ${new Date(s.lastUsedAt).toISOString()}`,
        ...(s.cacheHitRate !== undefined
          ? [`- cache hit rate: ${(s.cacheHitRate * 100).toFixed(1)}%`]
          : []),
        "",
      );
    }
  }
  out.push(
    `### Current pack for \`${input.currentKey}\` (${input.packTokens} tokens${input.overBudget ? "; over budget, hunk headers fallback" : ""})`,
    "",
  );
  if (input.instructionsNote) out.push(`_${input.instructionsNote}_`, "");
  out.push("#### L0 system", "", fence(input.system), "", "#### L1 + L1b + L2", "", fence(input.pack), "");
  return out.join("\n");
}

// --- log -------------------------------------------------------------------

export interface LogSectionInput {
  log: LogEntry[];
  /** Entries at or below this seq are already in the base (its `logSeq`). 0 when no base. */
  appendedThroughSeq: number;
  /** Base key the marker is relative to (current version/guide/model). */
  currentKey: string;
  /** False when no base exists yet (every entry is still waiting). */
  hasBase: boolean;
  /** Batch threshold in tokens (`logBatchTokens` setting). */
  batchTokens: number;
}

/**
 * Log section: every entry in order via `formatLogEntry`, each marked
 * `in base` (already appended), `ready to append` (a full batch waiting
 * for the next grow turn), or `waiting for batch` (below the threshold).
 * Readiness reuses `planGrowth`, the same pure planner the grow path uses.
 */
export function buildLogMarkdown(input: LogSectionInput): string {
  const out: string[] = ["## Log", ""];
  if (input.log.length === 0) {
    out.push("(log is empty)", "");
    return out.join("\n");
  }
  const plan = planGrowth(input.log, input.appendedThroughSeq, { batchTokens: input.batchTokens });
  const ready = new Set<number>();
  for (const batch of plan.batches) for (const e of batch) ready.add(e.seq);
  const pending = plan.pendingTokens;
  out.push(
    `${input.log.length} entr${input.log.length === 1 ? "y" : "ies"}. ` +
      (input.hasBase
        ? `Entries up to seq ${input.appendedThroughSeq} are already in base \`${input.currentKey}\`.`
        : "No base has been built yet, so every entry is still waiting.") +
      ` Batch threshold ${input.batchTokens} tokens${pending > 0 ? `; ${pending} tokens waiting` : ""}.`,
    "",
  );
  for (const entry of input.log) {
    const marker =
      entry.seq <= input.appendedThroughSeq
        ? "in base"
        : ready.has(entry.seq)
          ? "ready to append"
          : "waiting for batch";
    out.push(`${formatLogEntry(entry)} · ${marker}`);
  }
  out.push("");
  return out.join("\n");
}

// --- contributions -----------------------------------------------------------

/**
 * Status is only shown where it means something: corrections carry a
 * pending/accepted/dismissed workflow, and anything `merged` on a rebuild
 * is worth saying. A plain fact that is already in the log saying
 * "pending" would be misleading, so it is omitted.
 */
export function showContributionStatus(c: Contribution): boolean {
  if (c.status === "merged") return true;
  return c.items.some((i) => i.kind === "correction");
}

/** Contributions section: id, originating thread, replaces, then items (kind, text, target, citations). */
export function buildContributionsMarkdown(contributions: Contribution[]): string {
  const out: string[] = ["## Contributions", ""];
  if (contributions.length === 0) {
    out.push("(no contributions yet)", "");
    return out.join("\n");
  }
  out.push(`${contributions.length} contribution${contributions.length === 1 ? "" : "s"}.`, "");
  for (const c of contributions) {
    out.push(`### ${c.id}`, "");
    if (c.sourceThread) out.push(`- thread: \`${c.sourceThread}\``);
    else out.push(`- session: \`${c.sourceSession}\``);
    if (c.replaces) out.push(`- replaces: \`${c.replaces}\``);
    if (showContributionStatus(c)) out.push(`- status: ${c.status}`);
    for (const item of c.items) {
      const target = item.target ? ` → \`${item.target}\`` : "";
      // Continuation lines stay indented so leading `#`/`-` in agent text
      // cannot break out of the list item when rendered.
      const text = item.text.replace(/\n/g, "\n  ");
      out.push(`- **${item.kind}**${target}: ${text}`);
      if (item.citations.length > 0) {
        out.push(
          `  - cites: ${item.citations.map((cit) => `\`${cit.target}\`${cit.unverified ? " (unverified)" : ""}`).join(", ")}`,
        );
      }
    }
    out.push("");
  }
  return out.join("\n");
}
