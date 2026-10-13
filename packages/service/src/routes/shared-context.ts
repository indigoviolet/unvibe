/**
 * Per-review shared-context debug document (issue #32, PRD §9).
 *
 * - `GET /api/reviews/:id/shared-context` — the review's shared context as
 *   three Markdown strings the debug page (`/review/:id/debug`) renders
 *   as-is: base (per-base keys + stats, then the current base pack fenced),
 *   log (every entry in order with in-base/waiting markers), contributions.
 *   404 when the review is unknown.
 *
 * Read-only: this changes no log, rebuild, or contribution behaviour — it
 * only renders existing state. The pack is built the same way the pipeline
 * and the prompts expansion build it (`toPromptSnapshot` + `buildBasePack`
 * with the `instructions` template), so the page shows what agents receive.
 */
import type { FastifyInstance } from "fastify";
import type { SharedContextResponse } from "@unvibe/shared";
import { buildBasePack } from "../context/base.js";
import { baseKeyString } from "../sessions/manager.js";
import type { SessionManager } from "../sessions/manager.js";
import type { ModelCatalog, SettingsStore } from "../settings/index.js";
import { resolveEffectiveSettings } from "../settings/index.js";
import type { SharedContextService } from "../sharedctx/service.js";
import { buildBaseMarkdown, buildContributionsMarkdown, buildLogMarkdown } from "../sharedctx/debug.js";
import { loadTemplatesDirSync, renderTemplate } from "../prompts/index.js";
import { guideRevisionForSnapshot, toPromptSnapshot } from "./prompts.js";
import type { ServiceContext } from "./context.js";

type Ctx = ServiceContext & {
  sharedctx?: SharedContextService;
  sessions?: SessionManager;
  settings?: SettingsStore;
  models?: ModelCatalog;
  promptsDir?: string;
};

export async function registerSharedContext(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get("/api/reviews/:id/shared-context", async (req, reply) => {
    const { id } = req.params as { id: string };
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    const { ingestRefusal } = await import("../reviews/index.js");
    const refused = ingestRefusal(snapshot);
    if (refused) return reply.code(409).send({ error: refused });

    // Same effective settings the pipeline runs (issue #88), so the debug
    // page shows the base key and pack the agents actually get.
    const settings = ctx.settings
      ? await resolveEffectiveSettings({ settings: ctx.settings, models: ctx.models ?? null })
      : undefined;
    const provider = settings?.main.provider ?? "unknown";
    const model = settings?.main.model ?? "unknown";
    const currentKey = baseKeyString({
      reviewId: id,
      reviewVersion: `v${snapshot.version.n}`,
      guideRevision: guideRevisionForSnapshot(snapshot),
      provider,
      model,
    });

    // The pack the agents actually get: same snapshot adapter and builder
    // the pipeline (`ensureBase`) and the prompts expansion use.
    const promptSnap = toPromptSnapshot(snapshot, { model });
    let system = "";
    let instructionsNote: string | undefined;
    try {
      const lib = loadTemplatesDirSync(ctx.promptsDir ?? "");
      const tpl = lib.get("instructions");
      if (!tpl) {
        instructionsNote = "The instructions prompt could not be loaded, so L0 is shown empty.";
      } else {
        system = renderTemplate(tpl, {});
      }
    } catch {
      instructionsNote = "The instructions prompt could not be loaded, so L0 is shown empty.";
    }
    const pack = buildBasePack(promptSnap, system, {
      ...(settings?.inlineBudgetTokens !== undefined
        ? { inlineBudgetTokens: settings.inlineBudgetTokens }
        : {}),
    });

    const stats = ctx.sharedctx?.statsForReview(id) ?? [];
    const info = ctx.sessions?.baseInfo(currentKey);
    const hasBase = stats.length > 0 || info !== null;
    const batchTokens = settings?.logBatchTokens ?? 2000;

    const body: SharedContextResponse = {
      reviewId: id,
      base: buildBaseMarkdown({
        stats,
        currentKey,
        hasBase: hasBase ?? false,
        system,
        pack: pack.user,
        packTokens: pack.tokens,
        overBudget: pack.overBudget,
        ...(instructionsNote ? { instructionsNote } : {}),
      }),
      log: buildLogMarkdown({
        log: snapshot.logTail,
        appendedThroughSeq: info?.logSeq ?? 0,
        currentKey,
        hasBase: hasBase ?? false,
        batchTokens,
      }),
      contributions: buildContributionsMarkdown(snapshot.contributions),
    };
    return body;
  });
}
