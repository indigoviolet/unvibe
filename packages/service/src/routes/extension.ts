/**
 * Chrome extension routes (#322 part 1).
 *
 * - `GET /api/extension/pr-status?pr=<url>` — the only endpoint the
 *   extension's background worker calls. The server gate allowlists the
 *   exact extension origin for this path only; the install token (sent by
 *   the worker as Bearer, read from the service cookie) is still required.
 * - `GET /open?pr=<url>` — browser deep link the worker opens in a tab.
 *   Never mutates (CSRF: a top-level navigation carries the token
 *   cookie, so any site could otherwise trigger clones and agent
 *   spend): an existing review redirects straight to it; anything else
 *   renders an in-app confirm page. `POST /open` — behind the usual
 *   Origin/Host gate plus the token, like the app's other mutations —
 *   performs the open: clone the repo first when unknown, create or
 *   reuse the review, then redirect (303) to it.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
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
import {
  capPageCapture, estimateTokens, isGitHubPage, pageKey,
  type PanelThread,
} from "@unvibe/shared";
import { PanelStore } from "../panel/store.js";
import { retrieveAcrossRepos } from "../panel/retriever.js";

export const PANEL_PREFIX = "/api/extension/panel";

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
  // The confirm page posts a plain HTML form; the app otherwise speaks
  // JSON only. Parse urlencoded bodies into a flat object.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch (err) {
        done(err as Error);
      }
    },
  );
  // ---- #322 part 2 spike: side-panel web-document threads ----
  const panel = new PanelStore(ctx.dataDir);
  const activeRepos = async () => {
    const all = await listAllRepos(ctx);
    const real = all.filter((r) => r.localPath);
    const ids = panel.activeRepoIds ?? real.slice(0, 3).map((r) => r.id);
    return { all: real, active: real.filter((r) => ids.includes(r.id)) };
  };
  app.get(`${PANEL_PREFIX}/active-repos`, async () => {
    const { all, active } = await activeRepos();
    return { repos: all.map((r) => ({ id: r.id, owner: r.owner, name: r.name, active: active.some((a) => a.id === r.id) })) };
  });
  app.put(`${PANEL_PREFIX}/active-repos`, async (req, reply) => {
    const body = (req.body ?? {}) as { repoIds?: unknown };
    if (!Array.isArray(body.repoIds) || body.repoIds.some((x) => typeof x !== "string")) {
      return reply.code(400).send({ error: "repoIds: string[] required" });
    }
    panel.setActiveRepoIds(body.repoIds as string[]);
    return { ok: true };
  });
  app.get(`${PANEL_PREFIX}/thread`, async (req, reply) => {
    const url = (req.query as { url?: string }).url ?? "";
    if (!isGitHubPage(url)) return reply.code(400).send({ error: "spike scope: github.com pages only" });
    const key = pageKey(url);
    return panel.thread(key) ?? { pageKey: key, url, title: "", messages: [] } satisfies PanelThread;
  });
  app.post(`${PANEL_PREFIX}/ask`, async (req, reply) => {
    const b = (req.body ?? {}) as { url?: string; title?: string; selection?: string; context?: string; question?: string };
    if (!b.url || !isGitHubPage(b.url)) return reply.code(400).send({ error: "spike scope: github.com pages only" });
    const question = (b.question ?? "").trim();
    if (!question) return reply.code(400).send({ error: "question required" });
    const cap = capPageCapture({ url: b.url, title: b.title ?? "", selection: b.selection ?? "", context: b.context ?? "", capturedAt: Date.now() });
    const { active } = await activeRepos();
    // Spike: deterministic retriever stands in for the agent turn (no live
    // tokens). It reads only active worktrees; see docs/spikes/322-side-panel.
    const r = retrieveAcrossRepos(active, question, cap.selection);
    const key = pageKey(cap.url);
    const thread: PanelThread = panel.thread(key) ?? { pageKey: key, url: cap.url, title: cap.title, messages: [] };
    thread.title = cap.title || thread.title;
    thread.messages.push(
      { role: "user", text: cap.selection ? `“${cap.selection}”\n${question}` : question, citations: [], reposUsed: [], reads: [], at: Date.now() },
      { role: "assistant", text: r.answer, citations: r.citations, reposUsed: r.reposUsed, reads: r.reads, at: Date.now() },
    );
    panel.putThread(thread);
    return { thread, tokensEstimate: estimateTokens(cap.context + question) + 400, reposUsed: r.reposUsed };
  });

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

  const parseOr400 = (raw: string | undefined, reply: FastifyReply) => {
    try {
      return parseOpenPrUrl(raw);
    } catch (err) {
      void reply
        .code(400)
        .type("text/html")
        .send(`<!doctype html><title>Unvibe</title><p>${escapeHtml((err as Error).message)}</p>`);
      return null;
    }
  };

  // Read-only: redirect to an existing review, else the confirm page.
  app.get("/open", async (req, reply) => {
    const query = req.query as { pr?: string };
    const parsed = parseOr400(query.pr, reply);
    if (!parsed) return reply;
    const repo = await resolveRepo(ctx, parsed.owner, parsed.name);
    const found = repo ? helpers.lookupPrReview(repo.id, parsed.prNumber) : null;
    if (found) {
      return reply.redirect(`/review/${encodeURIComponent(found.id)}`);
    }
    const name = `${parsed.owner}/${parsed.name}#${parsed.prNumber}`;
    const what = repo
      ? "This will start a new review of this pull request in Unvibe. Opening a review runs the guide pipeline, which can use agent tokens."
      : `Unvibe doesn't have ${name.split("#")[0]} yet. This will clone that repo into Unvibe's own storage and start a new review of this pull request. Opening a review runs the guide pipeline, which can use agent tokens.`;
    return reply.type("text/html").send(
      [
        "<!doctype html>",
        '<html lang="en"><head><meta charset="utf-8" />',
        `<title>Review ${escapeHtml(name)} in Unvibe?</title></head><body>`,
        `<h1>Review ${escapeHtml(name)} in Unvibe?</h1>`,
        `<p>${escapeHtml(what)}</p>`,
        '<form method="post" action="/open">',
        `<input type="hidden" name="pr" value="${escapeHtml(parsed.url)}" />`,
        '<button type="submit">Start review</button>',
        "</form>",
        '<p><a href="/">Cancel</a></p>',
        "</body></html>",
      ].join("\n"),
    );
  });

  // The mutation: same protection as the app's other POSTs (loopback
  // Host/Origin gate in server.ts, plus the install token). The confirm
  // page's form posts here from the app origin; a foreign origin is
  // refused by the gate before this runs. No auto-submit anywhere.
  app.post("/open", async (req, reply) => {
    const body = (req.body ?? {}) as { pr?: string };
    const query = req.query as { pr?: string };
    const parsed = parseOr400(typeof body.pr === "string" ? body.pr : query.pr, reply);
    if (!parsed) return reply;
    let repo = await resolveRepo(ctx, parsed.owner, parsed.name);
    if (!repo) {
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
    return reply.redirect(`/review/${encodeURIComponent(result.snapshot.review.id)}`, 303);
  });
}
