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
import { askAction, replyAction, retryAction } from "./ask.js";
import { bookmarkAction, collapseAction, readAction } from "./read.js";
import { closeAction, deleteAction } from "./close.js";
import { conceptAction } from "./concept.js";
import { depthAction } from "./depth.js";
import { diagramAction } from "./diagram.js";
import { examplesAction } from "./examples.js";
import { explainAction } from "./explain.js";
import { followupAction } from "./followup.js";
import { noteAction } from "./note.js";
import { promoteAction } from "./promote.js";
import { removeSecondOpinionAction, secondOpinionAction } from "./second_opinion.js";
import { undoAction } from "./undo.js";
import type { ActionContext } from "./common.js";

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
  return reply.code(400).send({ error: message });
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
          const msg = (err as Error).message;
          if (/no pending card|unknown review/.test(msg)) return reply.code(404).send({ error: msg });
          return reply.code(500).send({ error: msg });
        }
      }
      case "explain": {
        need(ctx);
        if (typeof action.quote !== "string" || !action.anchor) return bad(reply, "quote and anchor are required");
        const res = await explainAction(ctx, { quote: action.quote, anchor: action.anchor });
        const out: ActionResponse = { accepted: true, annotationId: res.annotationId };
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
        const out: ActionResponse = { accepted: true, annotationId: res.threadId, threadId: res.threadId };
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
        return { accepted: true, annotationId: res.threadId, threadId: res.threadId } satisfies ActionResponse;
      }
      case "reply": {
        need(ctx);
        if (typeof action.threadId !== "string" || typeof action.message !== "string") {
          return bad(reply, "threadId and message are required");
        }
        const res = await replyAction(ctx, action.threadId, action.message);
        const out: ActionResponse = { accepted: true, threadId: res.threadId, annotationId: res.threadId };
        if (res.jobId) out.jobId = res.jobId;
        return out;
      }
      case "retry": {
        need(ctx);
        if (typeof action.threadId !== "string") return bad(reply, "threadId is required");
        const res = await retryAction(ctx, action.threadId);
        const out: ActionResponse = { accepted: true, threadId: res.threadId, annotationId: res.threadId };
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
      case "read": {
        need(ctx);
        if (typeof action.cardId !== "string" || typeof action.read !== "boolean") {
          return bad(reply, "cardId and read are required");
        }
        const res = await readAction(ctx, action.cardId, action.read);
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
            const msg = (err as Error).message;
            if (/unknown second opinion|unknown card|unknown review/.test(msg)) {
              return reply.code(404).send({ error: msg });
            }
            return reply.code(500).send({ error: msg });
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
          const msg = (err as Error).message;
          if (/unknown review|unknown card/.test(msg)) return reply.code(404).send({ error: msg });
          if (/different model|Settings/.test(msg)) return reply.code(400).send({ error: msg });
          return reply.code(500).send({ error: msg });
        }
      }
      default:
        return reply.code(501).send({ error: `unknown action: ${(action as { kind: string }).kind}` });
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (/unknown review|unknown card|unknown annotation|unknown comment|unknown follow-up|unknown page|unknown block|unknown file|unknown description|unknown thread|unknown second opinion/.test(msg)) {
      return reply.code(404).send({ error: msg });
    }
    if (/required|must be|bad |invalid|no failed|cannot be retried|has a failed/.test(msg)) {
      return reply.code(400).send({ error: msg });
    }
    if (/not available in this build/.test(msg)) {
      return reply.code(501).send({ error: msg });
    }
    return reply.code(500).send({ error: msg });
  }
}
