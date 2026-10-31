/**
 * Chrome extension routes (#322 part 1).
 *
 * - `GET /api/extension/pr-status?pr=<url>` — the only endpoint the
 *   extension's background worker calls. The server gate allowlists the
 *   exact extension origin for this path only; the install token (sent by
 *   the worker as Bearer, read from the service cookie) is still required.
 * - `GET /open?pr=<url>` — browser deep link the worker opens in a tab.
 *   Opens or creates the review for the PR, adding (cloning) the repo
 *   first when it is not known yet, then redirects to the review. The
 *   token cookie authenticates the navigation like any app page.
 */
import type { FastifyInstance } from "fastify";
import {
  EXTENSION_PR_STATUS_PATH,
  ingestStatusOf,
  parseOpenPrUrl,
  type PrReviewStatusResponse,
  type Repo,
  type ReviewSnapshot,
} from "@unvibe/shared";
import { addManagedRepo, CloneError } from "../repos/index.js";
import type { ServiceContext } from "./context.js";
import { listAllRepos } from "./repos.js";

export interface ExtensionReviewHelpers {
  lookupPrReview: (
    repoId: string,
    pr: number,
  ) => { id: string; snapshot: ReviewSnapshot } | null;
  openPrReview: (
    repoId: string,
    pr: number,
  ) => Promise<
    | { ok: true; snapshot: ReviewSnapshot }
    | { ok: false; status: number; error: string }
  >;
}

function sameRepo(r: Repo, owner: string, name: string): boolean {
  return r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === name.toLowerCase();
}

async function resolveRepo(ctx: ServiceContext, owner: string, name: string): Promise<Repo | null> {
  const remembered = ctx.repos.list().find((r) => sameRepo(r, owner, name));
  if (remembered) return remembered;
  const all = await listAllRepos(ctx);
  return all.find((r) => sameRepo(r, owner, name)) ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function registerExtensionRoutes(
  app: FastifyInstance,
  ctx: ServiceContext,
  helpers: ExtensionReviewHelpers,
): Promise<void> {
  app.get(EXTENSION_PR_STATUS_PATH, async (req, reply) => {
    const query = req.query as { pr?: string };
    let parsed;
    try {
      parsed = parseOpenPrUrl(query.pr);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    const repo = await resolveRepo(ctx, parsed.owner, parsed.name);
    const found = repo ? helpers.lookupPrReview(repo.id, parsed.prNumber) : null;
    const body: PrReviewStatusResponse = found
      ? {
          exists: true,
          reviewId: found.id,
          status: ingestStatusOf(found.snapshot),
          prUrl: parsed.url,
        }
      : { exists: false, prUrl: parsed.url };
    return body;
  });

  app.get("/open", async (req, reply) => {
    const query = req.query as { pr?: string };
    let parsed;
    try {
      parsed = parseOpenPrUrl(query.pr);
    } catch (err) {
      return reply
        .code(400)
        .type("text/html")
        .send(`<!doctype html><title>Unvibe</title><p>${escapeHtml((err as Error).message)}</p>`);
    }
    let repo = await resolveRepo(ctx, parsed.owner, parsed.name);
    if (!repo) {
      // As pasting the URL on the start page does, offer-to-clone becomes
      // automatic here: the user clicked "Review in Unvibe" on the PR.
      try {
        const added = await addManagedRepo(
          { runner: ctx.runner, dataDir: ctx.dataDir, repos: ctx.repos },
          parsed.owner,
          parsed.name,
        );
        repo = added.repo;
      } catch (err) {
        if (err instanceof CloneError) {
          return reply
            .code(err.status)
            .type("text/html")
            .send(`<!doctype html><title>Unvibe</title><p>${escapeHtml(err.message)}</p>`);
        }
        throw err;
      }
    }
    const result = await helpers.openPrReview(repo.id, parsed.prNumber);
    if (!result.ok) {
      return reply
        .code(result.status)
        .type("text/html")
        .send(`<!doctype html><title>Unvibe</title><p>${escapeHtml(result.error)}</p>`);
    }
    return reply.redirect(`/review/${encodeURIComponent(result.snapshot.review.id)}`);
  });
}
