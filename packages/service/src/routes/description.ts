/**
 * PR description editing (M6, PRD 4.11).
 *
 * - `PUT /api/reviews/:id/description` stores the edited HTML locally as
 *   pending (allowed only when the user is the PR author and the PR is not
 *   merged — the viewer comes from `gh api user`). The edited HTML is
 *   converted back to Markdown with byte-for-byte round-trip outside edited
 *   paragraphs (original Markdown kept per paragraph id; only changed
 *   paragraphs regenerate). Edits keep paragraph identity so citations and
 *   annotations still resolve.
 * - `DELETE …/description` reverts the pending edit.
 */
import type { FastifyInstance } from "fastify";
import type { UpdateDescriptionRequest } from "@unvibe/shared";
import { runGh } from "../exec/index.js";
import { readReviewRow } from "../ingest/index.js";
import { ingestRefusal } from "../reviews/index.js";
import {
  buildParagraphSources,
  cleanEditedHtml,
  editedHtmlToMarkdown,
  isDescriptionChanged,
} from "../submit/description.js";
import type { ServiceContext } from "./context.js";

async function ghJson(
  ctx: ServiceContext,
  repoPath: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runGh(ctx.runner, args, { args, cwd: repoPath });
}

/** PUT /api/reviews/:id/description (local edit, pending until submit) + revert */
export async function registerDescription(app: FastifyInstance, ctx?: ServiceContext): Promise<void> {
  if (!ctx) {
    app.put("/api/reviews/:id/description", async (_req, reply) =>
      reply.code(501).send({ error: "not implemented" }),
    );
    return;
  }

  app.put("/api/reviews/:id/description", async (req, reply) => {
    const { id } = req.params as { id: string };
    const reqBody = (req.body ?? {}) as UpdateDescriptionRequest;
    if (!reqBody || typeof reqBody.html !== "string") {
      return reply.code(400).send({ error: "html is required" });
    }
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: `unknown review ${id}` });
    const refused = ingestRefusal(snapshot);
    if (refused) return reply.code(409).send({ error: refused });
    const row = readReviewRow(ctx.db, id);
    const prNumber = row?.prNumber ?? snapshot.review.prNumber;
    if (prNumber === null || prNumber === undefined) {
      return reply.code(400).send({ error: "branch has no PR: description is read-only commit messages" });
    }
    if (!snapshot.description || snapshot.description.source !== "pr") {
      return reply.code(400).send({ error: "description is read-only for this review" });
    }
    const repo = row ? ctx.repos.get(row.repoId) : null;
    if (!repo) return reply.code(404).send({ error: "unknown repo" });

    // Author + open-PR check (PRD 4.11): viewer via `gh api user`.
    const viewArgs = ["pr", "view", String(prNumber), "--json", "author,state,body"];
    const viewRes = await ghJson(ctx, repo.localPath, viewArgs);
    if (viewRes.code !== 0) {
      return reply
        .code(502)
        .send({ error: `gh pr view failed: ${viewRes.stderr.trim() || viewRes.stdout.trim()}` });
    }
    let authorLogin = "";
    let state = "";
    try {
      const json = JSON.parse(viewRes.stdout) as {
        author?: { login?: string };
        state?: string;
        body?: string;
      };
      authorLogin = json.author?.login ?? "";
      state = json.state ?? "";
    } catch {
      return reply.code(502).send({ error: "gh pr view returned invalid JSON" });
    }
    const userArgs = ["api", "user"];
    const userRes = await ghJson(ctx, repo.localPath, userArgs);
    if (userRes.code !== 0) {
      return reply
        .code(502)
        .send({ error: `gh api user failed: ${userRes.stderr.trim() || userRes.stdout.trim()}` });
    }
    let viewer = "";
    try {
      viewer = (JSON.parse(userRes.stdout) as { login?: string }).login ?? "";
    } catch {
      return reply.code(502).send({ error: "gh api user returned invalid JSON" });
    }
    if (!viewer || viewer !== authorLogin) {
      return reply.code(403).send({
        error: `only the PR author (${authorLogin || "unknown"}) can edit the description`,
      });
    }
    if (state !== "OPEN") {
      return reply.code(403).send({ error: `PR is ${state || "not open"}; description is read-only` });
    }

    const cleaned = cleanEditedHtml(reqBody.html);
    const storedHtml = snapshot.description.pendingHtml ?? snapshot.description.html;
    if (!isDescriptionChanged(storedHtml, cleaned)) {
      // No change: clear a stale pending edit if the edit matches stored.
      if (snapshot.description.pendingHtml !== undefined) {
        await ctx.reviews.mutate(id, (draft) => {
          if (!draft.description) return;
          delete draft.description.pendingHtml;
          delete draft.description.pendingMarkdown;
        });
      }
      return { ok: true, changed: false };
    }

    // Backfill pre-M6 snapshots that lack the verbatim base.
    let baseMarkdown = snapshot.description.baseMarkdown;
    let sources = snapshot.description.paragraphSources;
    if (baseMarkdown === undefined || sources === undefined) {
      const bodyArgs = ["pr", "view", String(prNumber), "--json", "body"];
      const bodyRes = await ghJson(ctx, repo.localPath, bodyArgs);
      if (bodyRes.code !== 0) {
        return reply.code(502).send({ error: "cannot load PR body for round-trip" });
      }
      try {
        baseMarkdown = (JSON.parse(bodyRes.stdout) as { body?: string }).body ?? "";
      } catch {
        return reply.code(502).send({ error: "gh pr view returned invalid JSON" });
      }
      const built = buildParagraphSources(baseMarkdown);
      sources = built.paragraphSources;
      const base = baseMarkdown;
      const srcs = sources;
      await ctx.reviews.mutate(id, (draft) => {
        if (!draft.description) return;
        draft.description.baseMarkdown = base;
        draft.description.paragraphSources = { ...srcs };
      });
    }

    const markdown = editedHtmlToMarkdown(baseMarkdown, cleaned);
    const html = cleaned;
    await ctx.reviews.mutate(id, (draft) => {
      if (!draft.description) return;
      draft.description.pendingHtml = html;
      draft.description.pendingMarkdown = markdown;
      if (draft.description.baseMarkdown === undefined) draft.description.baseMarkdown = baseMarkdown;
      if (draft.description.paragraphSources === undefined) {
        draft.description.paragraphSources = sources ? { ...sources } : {};
      }
    });
    return { ok: true, changed: true };
  });

  app.delete("/api/reviews/:id/description", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx) return reply.code(501).send({ error: "not implemented" });
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: `unknown review ${id}` });
    const refusedDel = ingestRefusal(snapshot);
    if (refusedDel) return reply.code(409).send({ error: refusedDel });
    await ctx.reviews.mutate(id, (draft) => {
      if (!draft.description) return;
      delete draft.description.pendingHtml;
      delete draft.description.pendingMarkdown;
    });
    return { ok: true };
  });
}


