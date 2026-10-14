/**
 * Second-opinion base sessions (PRD §12).
 *
 * Its own base, never a fork of the main base: a fresh session on the
 * second-opinion model containing L0 + L1. One base per (version, model)
 * is reused across second opinions via fork or the byte-identical fallback
 * (PRD §6), since L0 + L1 is common; the per-request part (topic or claim
 * + cited code) goes in the turn.
 *
 * Isolation is structural under the lock-down: the base pack is built
 * from L0 instructions + L1 source only. Guide text, findings,
 * contributions, the log, and the main model's pinned code never enter —
 * except cited excerpts, which travel in the turn, not the base. Under
 * full access (issue #160) this isolation is a PROMPT rule only: the
 * session has a shell and can read the data directory, so it could reach
 * guide text and other reviews despite the rule. See docs/acp-runner.md.
 */
import path from "node:path";
import type { AccessMode, AgentRunner, Session } from "@unvibe/shared";
import { accessModeOf } from "@unvibe/shared";
import { buildL1Source } from "../context/index.js";
import { loadTemplatesDirSync } from "../prompts/index.js";
import { renderSystemPrompt } from "../prompts/access.js";
import { toPromptSnapshot } from "../routes/prompts.js";
import type { McpRegistry } from "../mcp/index.js";
import type { SessionManager } from "../sessions/manager.js";
import type { ReviewStore } from "../state/store.js";
import type { SettingsStore } from "../settings/index.js";
import { resolveEffectiveSettings } from "../settings/index.js";
import type { ModelCatalog } from "../settings/index.js";
import { RetryableError } from "../jobs/errors.js";

export interface SecondOpinionBaseDeps {
  reviews: ReviewStore;
  sessions: SessionManager;
  runner: AgentRunner;
  mcp: McpRegistry;
  settings: SettingsStore;
  /** Model catalog for live role defaults (issue #88): same effective settings as GET /api/settings. Absent → stored settings stand. */
  models?: ModelCatalog | null;
  dataDir: string;
  promptsDir: string;
  mcpBaseUrl: string;
}

function worktreeOf(dataDir: string, reviewId: string): string {
  return path.join(dataDir, "worktrees", reviewId);
}

function renderInstructions(promptsDir: string, access: AccessMode): string {
  const lib = loadTemplatesDirSync(promptsDir);
  return renderSystemPrompt(lib, access);
}

/**
 * Build the common L0 + L1 base text for a review. Deterministic: same
 * snapshot renders to the same bytes (provider caching). Uses the
 * effective second-opinion model (issue #88).
 */
export async function buildSecondOpinionBaseText(
  deps: Pick<SecondOpinionBaseDeps, "reviews" | "settings" | "models" | "promptsDir">,
  reviewId: string,
): Promise<{ instructions: string; sourceText: string; packText: string; version: number }> {
  const snapshot = deps.reviews.getSnapshot(reviewId);
  if (!snapshot) throw new Error(`unknown review ${reviewId}`);
  const settings = await resolveEffectiveSettings({ settings: deps.settings, models: deps.models ?? null });
  const promptSnap = toPromptSnapshot(snapshot, { model: settings.secondOpinion.model });
  const l1 = buildL1Source(promptSnap, { inlineBudgetTokens: settings.inlineBudgetTokens });
  const instructions = renderInstructions(deps.promptsDir, accessModeOf(settings));
  const sourceText = l1.text;
  const packText =
    `Read the review source below and reply with exactly \`ready\` and nothing else.\n\n` +
    `${instructions}\n\n${sourceText}`;
  return { instructions, sourceText, packText, version: snapshot.version.n };
}

/**
 * Get (or build) the shared second-opinion base for (version, model).
 * Keyed by reviewVersion + fixed "so" guideRevision + provider + model.
 */
export async function ensureSecondOpinionBase(
  deps: SecondOpinionBaseDeps,
  reviewId: string,
): Promise<{ session: Session; viaCache: boolean; version: number }> {
  const snapshot = deps.reviews.getSnapshot(reviewId);
  if (!snapshot) throw new Error(`unknown review ${reviewId}`);
  const settings = await resolveEffectiveSettings({ settings: deps.settings, models: deps.models ?? null });
  const { packText, version } = await buildSecondOpinionBaseText(deps, reviewId);
  const instructions = renderInstructions(deps.promptsDir, accessModeOf(settings));
  const key = {
    reviewId,
    reviewVersion: `v${snapshot.version.n}`,
    guideRevision: "so",
    provider: settings.secondOpinion.provider,
    model: settings.secondOpinion.model,
    access: accessModeOf(settings),
  };
  const mcp = deps.mcp.issueSession(reviewId, `so-base-${reviewId}-v${version}`, "second-opinion");
  const mcpServers = [{ name: "unvibe", url: `${deps.mcpBaseUrl}${mcp.path}` }];
  const handle = await deps.sessions.getBase({
    key,
    cwd: worktreeOf(deps.dataDir, reviewId),
    systemPrompt: instructions,
    readOnly: accessModeOf(settings) !== "full",
    mcpServers,
    pack: packText,
  });
  if (!handle.fresh) {
    // Warm base: this call's MCP URL was never handed to any session.
    deps.mcp.revokeSession(mcp.secret);
  }
  return { session: handle.session, viaCache: !handle.fresh, version };
}

/**
 * Fork the second-opinion base for one request, or fall back to a fresh
 * session with a byte-identical base pack (PRD §6) when `fork` is
 * unavailable. Returns the conversation session plus whether fork was used.
 */
export async function forkSecondOpinionBase(
  deps: SecondOpinionBaseDeps,
  reviewId: string,
): Promise<{ session: Session; viaFork: boolean; version: number }> {
  const snapshot = deps.reviews.getSnapshot(reviewId);
  if (!snapshot) throw new Error(`unknown review ${reviewId}`);
  const settings = await resolveEffectiveSettings({ settings: deps.settings, models: deps.models ?? null });
  const { packText, version } = await buildSecondOpinionBaseText(deps, reviewId);
  const instructions = renderInstructions(deps.promptsDir, accessModeOf(settings));
  const base = await ensureSecondOpinionBase(deps, reviewId);
  const runner = deps.runner;
  if (typeof runner.fork === "function") {
    try {
      const session = await runner.fork(base.session);
      return { session, viaFork: true, version };
    } catch {
      // fall through to fresh-session fallback
    }
  }
  const mcp = deps.mcp.issueSession(reviewId, `so-fork-${Date.now()}`, "second-opinion");
  const session = await runner.start({
    provider: settings.secondOpinion.provider,
    model: settings.secondOpinion.model,
    cwd: worktreeOf(deps.dataDir, reviewId),
    systemPrompt: instructions,
    readOnly: accessModeOf(settings) !== "full",
    mcpServers: [{ name: "unvibe", url: `${deps.mcpBaseUrl}${mcp.path}` }],
  });
  // Byte-identical base pack first (caching still works).
  for await (const ev of runner.prompt(session, packText)) {
    if (ev.type === "error" && ev.retryable) throw new RetryableError(ev.message);
    if (ev.type === "error") throw new Error(ev.message);
  }
  return { session, viaFork: false, version };
}
