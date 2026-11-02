/**
 * Chrome extension routes (#322 part 1, #335).
 *
 * - `GET /api/extension/pr-status?pr=<url>` — read-only lookup the
 *   extension's background worker calls for the button label. The server
 *   gate allowlists the exact extension origin for this path only; the
 *   install token (sent by the worker as Bearer, read from the service
 *   cookie) is still required.
 * - `POST /api/extension/open` (#335) — the button's create-or-open: same
 *   origin + token gate, same open path as `POST /open` below (clone the
 *   repo first when unknown, create or reuse the review), but answers the
 *   review id as JSON so the worker can open `/review/<id>` directly with
 *   no confirmation step.
 * - `GET /open?pr=<url>` — browser deep link for plain links from
 *   anywhere. Never mutates (CSRF: a top-level navigation carries the
 *   token cookie, so any site could otherwise trigger clones and agent
 *   spend): an existing review redirects straight to it; anything else
 *   redirects to the in-app confirm page (`/open/confirm`, served by the
 *   web app). `POST /open` — behind the usual Origin/Host gate plus the
 *   token, like the app's other mutations — performs the open: clone the
 *   repo first when unknown, create or reuse the review, then redirect
 *   (303) to it.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  EXTENSION_OPEN_PATH, EXTENSION_PANEL_PREFIX, EXTENSION_PR_STATUS_PATH,
  capPageCapture, captureHash, estimateTokens, ingestStatusOf, pageKey, parseOpenPrUrl,
  DEFAULT_REVIEW_VIEW_PREFS,
  type AgentRunner, type ExtensionOpenResponse, type ExtensionStatusResponse, type PanelActiveReposResponse,
  type PanelAskRequest, type PanelAskResponse, type PanelThread,
  type ParsedPrUrl,
  type PrReviewStatusResponse, type Repo, type ReviewSnapshot, type Settings, type Version,
} from "@unvibe/shared";
import { addManagedRepo, CloneError } from "../repos/index.js";
import { newReviewId } from "../ingest/index.js";
import { transaction } from "../store/index.js";
import { retrieveAcrossRepos } from "../panel/retriever.js";
import { panelAnswer } from "../panel/ask.js";
import { extensionFolderPath, lastWorkerCall, noteWorkerCall, openExtensionFolder, workerConnected } from "../panel/status.js";
import type { SettingsStore } from "../settings/index.js";
import type { ServiceContext } from "./context.js";
import { listAllRepos } from "./repos.js";

export interface ExtensionPanelDeps {
  settings?: SettingsStore;
  agents?: AgentRunner;
}

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
  panelDeps: ExtensionPanelDeps = {},
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
  // ---- #322 part 2: side panel ----
  const panelSettings = (): Settings | null => {
    try { return panelDeps.settings?.get() ?? null; } catch { return null; }
  };
  const activeRepos = async (): Promise<{ all: Repo[]; active: Repo[] }> => {
    const all = (await listAllRepos(ctx)).filter((r) => r.localPath);
    const s = panelSettings();
    const ids = s?.extensionActiveRepoIds ?? all.slice(0, 3).map((r) => r.id);
    return { all, active: all.filter((r) => ids.includes(r.id)) };
  };
  const findWebReview = (key: string): { id: string; snapshot: ReviewSnapshot } | null => {
    const rows = ctx.db.prepare("SELECT review_id FROM review_snapshots").all() as { review_id: string }[];
    for (const row of rows) {
      const snap = ctx.reviews.getSnapshot(row.review_id);
      if (snap?.web && snap.web.pageKey === key) return { id: row.review_id, snapshot: snap };
    }
    return null;
  };
  app.get(`${EXTENSION_PANEL_PREFIX}/active-repos`, async () => {
    noteWorkerCall();
    const { all, active } = await activeRepos();
    const body: PanelActiveReposResponse = {
      repos: all.map((r) => ({ id: r.id, owner: r.owner, name: r.name, active: active.some((a) => a.id === r.id) })),
    };
    return body;
  });
  app.put(`${EXTENSION_PANEL_PREFIX}/active-repos`, async (req, reply) => {
    noteWorkerCall();
    const body = (req.body ?? {}) as { repoIds?: unknown };
    if (!panelDeps.settings) return reply.code(501).send({ error: "not available in this build" });
    if (!Array.isArray(body.repoIds) || body.repoIds.some((x) => typeof x !== "string")) {
      return reply.code(400).send({ error: "repoIds: string[] required" });
    }
    panelDeps.settings.update({ extensionActiveRepoIds: body.repoIds as string[] });
    return { ok: true };
  });
  app.get(`${EXTENSION_PANEL_PREFIX}/thread`, async (req, reply) => {
    noteWorkerCall();
    const url = (req.query as { url?: string }).url ?? "";
    let key: string;
    try { key = pageKey(url); } catch { return reply.code(400).send({ error: "url required" }); }
    const found = findWebReview(key);
    if (!found?.snapshot.web) {
      const empty: PanelThread = { pageKey: key, url, title: "", messages: [] };
      return empty;
    }
    const w = found.snapshot.web;
    const thread: PanelThread = { pageKey: w.pageKey, url: w.url, title: w.title, messages: w.messages };
    return thread;
  });
  app.post(`${EXTENSION_PANEL_PREFIX}/ask`, async (req, reply) => {
    noteWorkerCall();
    const b = (req.body ?? {}) as PanelAskRequest;
    if (!b.url) return reply.code(400).send({ error: "url required" });
    const question = (b.question ?? "").trim();
    if (!question) return reply.code(400).send({ error: "question required" });
    let key: string;
    try { key = pageKey(b.url); } catch { return reply.code(400).send({ error: "url required" }); }
    const cap = capPageCapture({ url: b.url, title: b.title ?? "", selection: b.selection ?? "", context: b.context ?? "", capturedAt: Date.now() });
    const { active } = await activeRepos();
    const retrieval = retrieveAcrossRepos(active, question, cap.selection);
    const s = panelSettings();
    const pick = s?.extensionModel ?? { provider: "pi", model: "muse-spark-1.3-contributor", effort: "" };
    const answer = await panelAnswer(panelDeps.agents, pick, active[0]?.localPath ?? ctx.dataDir, question, cap, retrieval);
    const userText = cap.selection ? `"${cap.selection}"\n${question}` : question;
    const now = Date.now();
    let found = findWebReview(key);
    let reviewId: string;
    if (!found) {
      reviewId = newReviewId();
      const hash = captureHash(cap.context || cap.url);
      const version: Version = { n: 1, headSha: hash, mergeBaseSha: hash, baseRef: "web", fetchedAt: now, idMapping: {} };
      const snapshot: ReviewSnapshot = {
        review: { id: reviewId, repoId: active[0]?.id ?? "web", branch: "web", versions: [version], currentVersion: 1, createdAt: now },
        web: { url: cap.url, title: cap.title, pageKey: key, captureHash: hash, context: cap.context, messages: [] },
        version, files: [], pages: [], annotations: [], hunkStates: [], fileStates: [],
        viewPrefs: { ...DEFAULT_REVIEW_VIEW_PREFS }, jobs: [], contributions: [], logTail: [], rev: 1,
        ingest: { status: "ready" },
      };
      transaction(ctx.db, () => {
        ctx.db.prepare("INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(reviewId, active[0]?.id ?? "web", "web", null, 1, now, JSON.stringify({ title: cap.title || cap.url }));
        ctx.db.prepare("INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(review_id, n) DO NOTHING")
          .run(reviewId, 1, hash, hash, "web", now, "{}");
        ctx.reviews.putSnapshot(reviewId, snapshot);
      });
      found = { id: reviewId, snapshot };
    }
    reviewId = found.id;
    const updated = await ctx.reviews.mutate(reviewId, (draft) => {
      if (!draft.web) return;
      draft.web.title = cap.title || draft.web.title;
      draft.web.messages.push(
        { role: "user", text: userText, citations: [], reposUsed: [], reads: [], at: now },
        { role: "assistant", text: answer.text, citations: answer.citations, reposUsed: retrieval.reposUsed, reads: retrieval.reads, at: Date.now(), ...(cap.selection ? { quote: cap.selection } : {}) },
      );
    });
    const w = updated.snapshot.web!;
    const thread: PanelThread = { pageKey: w.pageKey, url: w.url, title: w.title, messages: w.messages };
    const body: PanelAskResponse = { thread, reviewId, reposUsed: retrieval.reposUsed, tokensEstimate: estimateTokens(cap.context + question) + 400 };
    return body;
  });

  // ---- install help (Settings → Extension, app origin) ----
  app.get("/api/extension/status", async () => {
    const body: ExtensionStatusResponse = {
      extensionPath: extensionFolderPath(),
      lastWorkerCallAt: lastWorkerCall(),
      connected: workerConnected(),
    };
    return body;
  });
  app.post("/api/extension/open-folder", async (_req, reply) => {
    try {
      await openExtensionFolder(ctx.runner);
      return { ok: true };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.get(EXTENSION_PR_STATUS_PATH, async (req, reply) => {
    noteWorkerCall();
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

  // Shared with both mutations below (`POST /open` and the extension's
  // `POST /api/extension/open`): remember or clone the repo, then create
  // or reuse the review. Throws CloneError when the clone fails.
  const openPr = async (parsed: ParsedPrUrl) => {
    let repo = await resolveRepo(ctx, parsed.owner, parsed.name);
    if (!repo) {
      const added = await addManagedRepo(
        { runner: ctx.runner, dataDir: ctx.dataDir, repos: ctx.repos },
        parsed.owner,
        parsed.name,
      );
      repo = added.repo;
    }
    const result = await helpers.openPrReview(repo.id, parsed.prNumber);
    return { repo, result };
  };

  // #335: the extension button's create-or-open. Same origin + token gate
  // as the other extension endpoints (exact allowlisted extension origin
  // only — see server.ts), same open path as `POST /open`, but answers
  // JSON so the worker can open the review directly with no confirm step.
  app.post(EXTENSION_OPEN_PATH, async (req, reply) => {
    noteWorkerCall();
    const body = (req.body ?? {}) as { pr?: string };
    let parsed: ParsedPrUrl;
    try {
      parsed = parseOpenPrUrl(body.pr);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    let opened: Awaited<ReturnType<typeof openPr>>;
    try {
      opened = await openPr(parsed);
    } catch (err) {
      if (err instanceof CloneError) {
        return reply.code(err.status).send({ error: err.message });
      }
      throw err;
    }
    if (!opened.result.ok) {
      return reply.code(opened.result.status).send({ error: opened.result.error });
    }
    const response: ExtensionOpenResponse = {
      reviewId: opened.result.snapshot.review.id,
      prUrl: parsed.url,
    };
    return response;
  });

  // Read-only: redirect to an existing review, else the in-app confirm
  // page (`/open/confirm`, a route in the web app — served by the static
  // fallback, so the confirm renders inside the app frame with the app's
  // components and styling). Never clones, never creates a review.
  app.get("/open", async (req, reply) => {
    const query = req.query as { pr?: string };
    const parsed = parseOr400(query.pr, reply);
    if (!parsed) return reply;
    const repo = await resolveRepo(ctx, parsed.owner, parsed.name);
    const found = repo ? helpers.lookupPrReview(repo.id, parsed.prNumber) : null;
    if (found) {
      return reply.redirect(`/review/${encodeURIComponent(found.id)}`);
    }
    return reply.redirect(`/open/confirm?pr=${encodeURIComponent(parsed.url)}`);
  });

  // The mutation: same protection as the app's other POSTs (loopback
  // Host/Origin gate in server.ts, plus the install token). The in-app
  // confirm page posts here from the app origin; a foreign origin is
  // refused by the gate before this runs. No auto-submit anywhere.
  app.post("/open", async (req, reply) => {
    const body = (req.body ?? {}) as { pr?: string };
    const query = req.query as { pr?: string };
    const parsed = parseOr400(typeof body.pr === "string" ? body.pr : query.pr, reply);
    if (!parsed) return reply;
    let opened: Awaited<ReturnType<typeof openPr>>;
    try {
      opened = await openPr(parsed);
    } catch (err) {
      if (err instanceof CloneError) {
        return reply
          .code(err.status)
          .type("text/html")
          .send(`<!doctype html><title>Unvibe</title><p>${escapeHtml(err.message)}</p>`);
      }
      throw err;
    }
    if (!opened.result.ok) {
      return reply
        .code(opened.result.status)
        .type("text/html")
        .send(`<!doctype html><title>Unvibe</title><p>${escapeHtml(opened.result.error)}</p>`);
    }
    return reply.redirect(`/review/${encodeURIComponent(opened.result.snapshot.review.id)}`, 303);
  });
}
