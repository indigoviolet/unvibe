/**
 * Actions dispatcher (M4/M6): one file per action kind.
 *
 * `generate` (Go deeper) and every interaction kind route here, plus
 * `second_opinion` via the isolated `secondopinion/` module (own base,
 * blind/check modes). Each action goes through `ReviewStore.mutate` so
 * the UI gets patches; each agent call runs at user-requested priority
 * with (anchor, kind, depth, base version) dedupe and citation validation
 * via the `runInFork` seam.
 */
import type { FastifyReply } from "fastify";
import type { ActionResponse, ReviewAction } from "@unvibe/shared";
import type { JobQueue } from "../../jobs/index.js";
import type { SessionManager } from "../../sessions/manager.js";
import type { SettingsStore } from "../../settings/index.js";
import type { SharedContextService } from "../../sharedctx/service.js";
import type { ReviewStore } from "../../state/store.js";
import type { Pipeline } from "../runner.js";
import { generateAction } from "./generate.js";
import { askAction, explainAction, hunkCardAction, replyAction, retryAction } from "./conversation.js";
import { bookmarkAction, collapseAction } from "./read.js";
import { closeAction, deleteAction } from "./close.js";
import { conceptAction } from "./concept.js";
import { depthAction } from "./depth.js";
import { diagramAction } from "./diagram.js";
import { examplesAction } from "./examples.js";
import { followupAction } from "./followup.js";
import { noteAction } from "./note.js";
import { promoteAction } from "./promote.js";
import { removeSecondOpinionAction, secondOpinionAction } from "./second_opinion.js";
import { undoAction } from "./undo.js";
import type { ActionContext } from "./common.js";
import { errorCodeFor, errorCodeOf, sendError } from "../../errors.js";

export interface ActionDeps {
  pipeline?: Pipeline;
  jobs?: JobQueue;
  reviews?: ReviewStore;
  sessions?: SessionManager;
  settings?: SettingsStore;
  sharedctx?: SharedContextService;
  fixturesDir?: string;
  promptsDir?: string;
}

function need(ctx: ActionContext): asserts ctx is Required<Pick<ActionContext, "pipeline" | "jobs" | "reviews">> & ActionContext {
  if (!ctx.pipeline || !ctx.jobs || !ctx.reviews) {
    throw new Error("not available in this build");
  }
}

function bad(reply: FastifyReply, message: string): unknown {
  return sendError(reply, 400, message, "invalid-request");
}

/**
 * Status for a caught action error (issue #86, finding 10): derived from
 * the error's code (carried or classified in `errors.ts`), never matched
 * here. Preserves the old mapping: unknown → 404, bad-request text →
 * 400, unwired → 501, else 500.
 */
function caughtStatus(code: ReturnType<typeof errorCodeFor>): number {
  switch (code) {
    case "not-found":
      return 404;
    case "invalid-request":
      return 400;
    case "not-implemented":
      return 501;
    default:
      return 500;
  }
}

function sendCaught(reply: FastifyReply, err: unknown): unknown {
  const msg = (err as Error).message;
  const code = errorCodeOf(err) ?? errorCodeFor(500, msg);
  return sendError(reply, caughtStatus(code), msg, code);
}

export async function dispatchAction(
  action: ReviewAction,
  deps: ActionDeps & { reviewId: string },
  reply: FastifyReply,
): Promise<unknown> {
  const ctx: ActionContext = {
    ...(deps.pipeline ? { pipeline: deps.pipeline } : {}),
    ...(deps.jobs ? { jobs: deps.jobs } : {}),
    ...(deps.reviews ? { reviews: deps.reviews } : {}),
    reviewId: deps.reviewId,
    ...(deps.sessions ? { sessions: deps.sessions } : {}),
    ...(deps.settings ? { settings: deps.settings } : {}),
    ...(deps.sharedctx ? { sharedctx: deps.sharedctx } : {}),
    ...(deps.fixturesDir ? { fixturesDir: deps.fixturesDir } : {}),
    ...(deps.promptsDir ? { promptsDir: deps.promptsDir } : {}),
  } as ActionContext;

  try {
    switch (action.kind) {
      case "generate": {
        need(ctx);
        if (!deps.pipeline || !deps.jobs || !deps.reviews) {
          return reply.code(501).send({ error: "not available in this build" });
        }
        try {
          const res = await generateAction(deps.pipeline, deps.jobs, deps.reviews, deps.reviewId, action.cardId);
          const out: ActionResponse = { accepted: true };
          if (res.jobId) out.jobId = res.jobId;
          if (res.reused) out.reused = true;
          return out;
        } catch (err) {
          return sendCaught(reply, err);
        }
      }
      case "explain": {
        need(ctx);
        if (typeof action.quote !== "string" || !action.anchor) return bad(reply, "quote and anchor are required");
        const res = await explainAction(ctx, { quote: action.quote, anchor: action.anchor });
        const out: ActionResponse = { accepted: true, annotationId: res.annotationId, turnId: res.turnId };
        if (res.jobId) out.jobId = res.jobId;
        if (res.deduplicated) out.deduplicated = true;
        if (res.reused) out.reused = true;
        return out;
      }
      case "ask": {
        need(ctx);
        if (typeof action.quote !== "string" || !action.anchor || typeof action.message !== "string") {
          return bad(reply, "quote, anchor and message are required");
        }
        const res = await askAction(ctx, { quote: action.quote, anchor: action.anchor, message: action.message });
        const out: ActionResponse = { accepted: true, annotationId: res.annotationId, turnId: res.turnId };
        if (res.jobId) out.jobId = res.jobId;
        if (res.deduplicated) out.deduplicated = true;
        if (res.reused) out.reused = true;
        return out;
      }
      case "note": {
        need(ctx);
        if (typeof action.quote !== "string" || !action.anchor) return bad(reply, "quote and anchor are required");
        const res = await noteAction(ctx, {
          quote: action.quote,
          anchor: action.anchor,
          ...(action.text !== undefined ? { text: action.text } : {}),
        });
        return { accepted: true, annotationId: res.annotationId } satisfies ActionResponse;
      }
      case "reply": {
        need(ctx);
        if (typeof action.annotationId !== "string" || typeof action.message !== "string") {
          return bad(reply, "annotationId and message are required");
        }
        const res = await replyAction(ctx, action.annotationId, action.message);
        const out: ActionResponse = { accepted: true, annotationId: res.annotationId, turnId: res.turnId };
        if (res.jobId) out.jobId = res.jobId;
        return out;
      }
      case "retry": {
        need(ctx);
        if (typeof action.annotationId !== "string") return bad(reply, "annotationId is required");
        const res = await retryAction(ctx, action.annotationId);
        const out: ActionResponse = { accepted: true, annotationId: res.annotationId, turnId: res.turnId };
        if (res.jobId) out.jobId = res.jobId;
        return out;
      }
      case "depth": {
        need(ctx);
        if (typeof action.cardId !== "string") return bad(reply, "cardId is required");
        if (action.direction !== "simpler" && action.direction !== "deeper") {
          return bad(reply, "direction must be simpler or deeper");
        }
        const res = await depthAction(ctx, action.cardId, action.direction);
        const out: ActionResponse = { accepted: true, cardId: res.cardId };
        if (res.jobId) out.jobId = res.jobId;
        if (res.deduplicated) out.deduplicated = true;
        if (res.reused) out.reused = true;
        // Issue #65: the client tells a stored-level switch (silent) from
        // already-at-the-limit (toast) by comparing this to the level it
        // saw at click time.
        if (res.level) out.level = res.level;
        return out;
      }
      case "examples": {
        need(ctx);
        if (typeof action.cardId !== "string") return bad(reply, "cardId is required");
        const res = await examplesAction(ctx, action.cardId);
        const out: ActionResponse = { accepted: true, cardId: res.cardId };
        if (res.jobId) out.jobId = res.jobId;
        if (res.deduplicated) out.deduplicated = true;
        if (res.reused) out.reused = true;
        return out;
      }
      case "diagram": {
        need(ctx);
        if (typeof action.cardId !== "string") return bad(reply, "cardId is required");
        const res = await diagramAction(ctx, action.cardId);
        const out: ActionResponse = { accepted: true, cardId: res.cardId };
        if (res.jobId) out.jobId = res.jobId;
        if (res.deduplicated) out.deduplicated = true;
        if (res.reused) out.reused = true;
        return out;
      }
      case "undo": {
        need(ctx);
        if (typeof action.cardId !== "string") return bad(reply, "cardId is required");
        const res = await undoAction(ctx, action.cardId);
        return { accepted: true, cardId: res.cardId } satisfies ActionResponse;
      }
      case "collapse": {
        need(ctx);
        if (typeof action.cardId !== "string" || typeof action.collapsed !== "boolean") {
          return bad(reply, "cardId and collapsed are required");
        }
        const res = await collapseAction(ctx, action.cardId, action.collapsed);
        return { accepted: true, cardId: res.cardId } satisfies ActionResponse;
      }
      case "bookmark": {
        need(ctx);
        if (typeof action.pageId !== "string" || typeof action.saved !== "boolean") {
          return bad(reply, "pageId and saved are required");
        }
        const res = await bookmarkAction(ctx, action.pageId, action.saved);
        return { accepted: true, pageId: res.pageId } satisfies ActionResponse;
      }
      case "promote": {
        need(ctx);
        if (typeof action.annotationId !== "string") return bad(reply, "annotationId is required");
        const res = await promoteAction(ctx, action.annotationId);
        return { accepted: true, annotationId: res.annotationId, pageId: res.pageId } satisfies ActionResponse;
      }
      case "hunk_card": {
        need(ctx);
        if (typeof action.fileKey !== "string" || typeof action.contentHash !== "string") {
          return bad(reply, "fileKey and contentHash are required");
        }
        const res = await hunkCardAction(ctx, action.fileKey, action.contentHash);
        return { accepted: true, annotationId: res.annotationId, turnId: res.turnId } satisfies ActionResponse;
      }
      case "close": {
        need(ctx);
        if (typeof action.annotationId !== "string") return bad(reply, "annotationId is required");
        const res = await closeAction(ctx, action.annotationId);
        return { accepted: true, annotationId: res.annotationId } satisfies ActionResponse;
      }
      case "delete": {
        need(ctx);
        if (typeof action.targetId !== "string") return bad(reply, "targetId is required");
        // Second-opinion removal travels over the generic `delete` action:
        // targetId `second-opinion:<cardId>:<mode>` or a stored `so-…`
        // opinion id. All other targets are annotation ids (M4).
        const target = action.targetId;
        const soMatch = target.match(/^second-opinion:([^:]+):(blind|check)$/) ?? target.match(/^(so-.*)$/);
        if (soMatch) {
          try {
            if (soMatch[1].startsWith("so-")) {
              await removeSecondOpinionAction(ctx.pipeline, ctx.jobs, ctx.reviews, ctx.reviewId, "", undefined, soMatch[1]);
            } else {
              const [, cardId, mode] = target.match(/^second-opinion:([^:]+):(blind|check)$/)!;
              await removeSecondOpinionAction(ctx.pipeline, ctx.jobs, ctx.reviews, ctx.reviewId, cardId, mode as "blind" | "check");
            }
            return { accepted: true } satisfies ActionResponse;
          } catch (err) {
            return sendCaught(reply, err);
          }
        }
        const res = await deleteAction(ctx, target);
        return { accepted: true, annotationId: res.targetId } satisfies ActionResponse;
      }
      case "followup": {
        need(ctx);
        if (typeof action.cardId !== "string" || typeof action.blockId !== "string" || !Number.isSafeInteger(action.index)) {
          return bad(reply, "cardId, blockId and index are required");
        }
        const res = await followupAction(ctx, action.cardId, action.blockId, action.index);
        const out: ActionResponse = { accepted: true, annotationId: res.annotationId, cardId: action.cardId };
        if (res.turnId) out.turnId = res.turnId;
        if (res.jobId) out.jobId = res.jobId;
        if (res.deduplicated) out.deduplicated = true;
        if ((res as { reused?: boolean }).reused) out.reused = true;
        return out;
      }
      case "concept": {
        need(ctx);
        if (typeof action.slug !== "string") return bad(reply, "slug is required");
        const res = await conceptAction(ctx, action.slug);
        const out: ActionResponse = { accepted: true, pageId: res.pageId };
        if (res.jobId) out.jobId = res.jobId;
        if (res.deduplicated) out.deduplicated = true;
        if (res.reused) out.reused = true;
        return out;
      }
      case "second_opinion": {
        need(ctx);
        if (typeof action.cardId !== "string") return bad(reply, "cardId is required");
        if (action.mode !== "blind" && action.mode !== "check") {
          return bad(reply, "mode must be blind or check");
        }
        try {
          const res = await secondOpinionAction(ctx.pipeline, ctx.jobs, ctx.reviews, ctx.reviewId, action.cardId, action.mode);
          const out: ActionResponse = { accepted: true };
          if (res.jobId) out.jobId = res.jobId;
          if (res.reused) out.reused = true;
          return out satisfies ActionResponse;
        } catch (err) {
          return sendCaught(reply, err);
        }
      }
      default:
        return reply.code(501).send({ error: `unknown action: ${(action as { kind: string }).kind}` });
    }
  } catch (err) {
    return sendCaught(reply, err);
  }
}
