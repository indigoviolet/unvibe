/**
 * Start-page repos (PRD §4.2):
 * - `GET /api/repos` — remembered repos (most recent first) plus detected
 *   local checkouts under the configured roots (marked `detected: true`).
 * - `POST /api/repos` — remember a checkout path (validated as a git
 *   checkout; owner/name derived from the `origin` remote), or clone a
 *   GitHub URL into Unvibe's own storage (#27, marked `managed: true`).
 * - `POST /api/repos/pick-folder` — open a native folder dialog and return
 *   the chosen path (#26; one dialog at a time, 409 while one is open).
 * - `DELETE /api/repos/:id` — forget a repo; deletes the managed clone
 *   directory only for clones Unvibe made (#27). Refused while reviews
 *   reference the repo.
 * - `GET /api/repos/:id/changes?filter=` — authoring / review-requested
 *   PRs, recent branches, previous reviews with stale state. Managed clones
 *   are `git fetch`ed first (best effort; failures degrade to stale data
 *   with a `fetchError` note, never a failed listing).
 */
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  parseGitHubRepoInput,
  type AddRepoRequest,
  type AddRepoResponse,
  type ChangesFilter,
  type PickFolderResponse,
  type RemoveRepoResponse,
  type Repo,
  type ReposResponse,
  type RepoChangesResponse,
  type RepoWorktreesResponse,
} from "@unvibe/shared";
import {
  addManagedRepo,
  deriveIdentity,
  detectCheckouts,
  CloneError,
  isGitCheckout,
  listWorktrees,
  newRepoId,
  pickFolder,
  refreshManagedCheckout,
  removeRepo,
  repoChanges,
  resolveRepoRoots,
} from "../repos/index.js";
import type { ServiceContext } from "./context.js";
import type { RouteDeps } from "./deps.js";

/** Stable id for a detected (not yet remembered) checkout. */
export function detectedRepoId(localPath: string): string {
  return `detected-${createHash("sha1").update(localPath, "utf8").digest("hex").slice(0, 12)}`;
}

const FILTERS: ChangesFilter[] = ["authoring", "review-requested", "branches", "recent", "all"];

/** Full repo list: remembered first, then detected checkouts. */
export async function listAllRepos(ctx: ServiceContext): Promise<Repo[]> {
  const remembered = ctx.repos.list();
  const knownPaths = new Set(remembered.map((r) => r.localPath));
  const detected: Repo[] = [];
  for (const checkout of detectCheckouts(resolveRepoRoots())) {
    if (knownPaths.has(checkout)) continue;
    try {
      const identity = await deriveIdentity(ctx.runner, checkout);
      detected.push({
        id: detectedRepoId(checkout),
        owner: identity.owner,
        name: identity.name,
        localPath: checkout,
        lastOpened: 0,
        detected: true,
      });
    } catch {
      // A checkout that can't be read is skipped, not fatal.
    }
  }
  return [...remembered, ...detected];
}

/** Demo repo for the start page (M3): synthetic, needs no checkout. */
export const DEMO_REPO = {
  id: "demo",
  owner: "demo",
  name: "urllib3-5020",
  localPath: "",
  lastOpened: 0,
  detected: true,
} as const;

/** GET /api/repos · POST /api/repos · POST /api/repos/pick-folder · DELETE /api/repos/:id · GET /api/repos/:id/changes */
export async function registerRepos(
  app: FastifyInstance,
  ctx: ServiceContext,
  deps: RouteDeps = {},
): Promise<void> {
  // One dialog at a time per app: the pick awaits the user's action, so a
  // second request while one is open gets 409 instead of stacking dialogs.
  let pickInFlight = false;
  app.get("/api/repos", async () => {
    const repos = await listAllRepos(ctx);
    // Demo first so the start page shows it without tokens (M3).
    return { repos: [{ ...DEMO_REPO }, ...repos] } satisfies ReposResponse;
  });

  app.post("/api/repos", async (req, reply) => {
    const body = (req.body ?? {}) as AddRepoRequest;
    const rawPath = typeof body.path === "string" ? body.path.trim() : "";
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (rawPath !== "" && rawUrl !== "") {
      return reply.code(400).send({ error: "either path or url is required (not both)" });
    }
    if (rawUrl !== "") {
      return addRepoByUrl(ctx, rawUrl, reply);
    }
    if (rawPath === "") {
      return reply.code(400).send({ error: "path or url is required" });
    }
    const { default: path } = await import("node:path");
    const localPath = path.resolve(rawPath);
    let ok = false;
    try {
      ok = await isGitCheckout(ctx.runner, localPath);
    } catch {
      ok = false;
    }
    if (!ok) {
      return reply.code(400).send({ error: `not a git repo: ${localPath}` });
    }
    const identity = await deriveIdentity(ctx.runner, localPath);
    const existing = ctx.repos.getByPath(localPath);
    const repo: Repo = existing
      ? { ...existing, owner: identity.owner, name: identity.name }
      : {
          id: newRepoId(),
          owner: identity.owner,
          name: identity.name,
          localPath,
          lastOpened: 0,
        };
    ctx.repos.upsert(repo);
    ctx.repos.touch(repo.id);
    const repos = await listAllRepos(ctx);
    return { repos: [{ ...DEMO_REPO }, ...repos] } satisfies AddRepoResponse;
  });

  app.delete("/api/repos/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id === "demo") return reply.code(404).send({ error: "unknown repo" });
    try {
      const { removedClone } = removeRepo(ctx.dataDir, ctx.repos, id);
      return { ok: true, removedClone } satisfies RemoveRepoResponse;
    } catch (err) {
      if (err instanceof CloneError) {
        return reply.code(err.status).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post("/api/repos/pick-folder", async (_req, reply) => {
    if (pickInFlight) {
      return reply.code(409).send({ error: "a folder dialog is already open" });
    }
    pickInFlight = true;
    try {
      return (await pickFolder(ctx.runner, deps.pickFolder)) satisfies PickFolderResponse;
    } finally {
      pickInFlight = false;
    }
  });

  // Issue #222: reading locations for the document context-repo picker.
  app.get("/api/repos/:id/worktrees", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id === "demo") return { worktrees: [] } satisfies RepoWorktreesResponse;
    let repo = ctx.repos.get(id);
    if (!repo) repo = (await listAllRepos(ctx)).find((r) => r.id === id) ?? null;
    if (!repo) return reply.code(404).send({ error: "unknown repo" });
    const worktrees = await listWorktrees(ctx.runner, repo.localPath);
    const rev = async (ref: string): Promise<string | undefined> => {
      try {
        const res = await ctx.runner.run("git", { args: ["rev-parse", ref], cwd: repo.localPath });
        return res.code === 0 ? res.stdout.trim() : undefined;
      } catch {
        return undefined;
      }
    };
    const [originMainSha, localSha] = await Promise.all([rev("origin/main"), rev("HEAD")]);
    return {
      worktrees,
      ...(originMainSha ? { originMainSha } : {}),
      ...(localSha ? { localSha } : {}),
    } satisfies RepoWorktreesResponse;
  });

  app.get("/api/repos/:id/changes", async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { filter?: string };
    const rawFilter = query.filter ?? "all";
    if (!(FILTERS as string[]).includes(rawFilter)) {
      return reply.code(400).send({ error: `unknown filter: ${query.filter}` });
    }
    // Demo entry point (M3): repo-less `demo` change. The start page lists
    // it without a checkout; creating a review with `repoId: "demo"` (or
    // `{ demo: true }`) ingests the fixture and runs the same pipeline path.
    // The demo answers no filtered section: PR/branch filters return [] so
    // the demo never leaks into "authoring" / "review-requested" / branches.
    if (id === "demo") {
      if (rawFilter !== "all") {
        return { changes: [] } satisfies RepoChangesResponse;
      }
      return {
        changes: [
          {
            kind: "demo",
            title: "Demo: urllib3#5020 — Unfold obsolete folded response headers",
            demo: "urllib3-5020",
          },
        ],
      } satisfies RepoChangesResponse;
    }
    const filter = rawFilter as ChangesFilter;
    let repo = ctx.repos.get(id);
    if (!repo) {
      // Detected checkouts are addressable too: resolve from the live list.
      repo = (await listAllRepos(ctx)).find((r) => r.id === id) ?? null;
    }
    if (!repo) return reply.code(404).send({ error: "unknown repo" });
    // Managed clones stay fresh: fetch before listing so PR heads and base
    // branches are current. Best effort — offline degrades to stale data
    // with a visible note, never a failed listing. User checkouts are never
    // fetched implicitly.
    const fetchError = await refreshManagedCheckout(ctx.runner, repo);
    const changes = await repoChanges({ runner: ctx.runner, db: ctx.db }, repo, filter);
    // #230: the Reviews list reuses this same `gh pr list` result — no
    // extra gh calls. Any review whose PR appears here takes its current
    // state/decision, and the stored review is updated. PRs not in the
    // result keep their stored state. Best effort: never fails the listing.
    await syncReviewsWithPrLists(ctx, changes);
    if (fetchError) return { changes, fetchError } satisfies RepoChangesResponse;
    return { changes } satisfies RepoChangesResponse;
  });
}

/**
 * #230: apply the start page's PR-list states to the stored reviews.
 * Only PR rows that already carry a `reviewId` (same repo + PR number)
 * are touched, and only when something would actually change (no empty
 * mutates, no rev bumps). Failures are swallowed — the listing wins.
 */
async function syncReviewsWithPrLists(
  ctx: ServiceContext,
  changes: import("@unvibe/shared").RepoChange[],
): Promise<void> {
  for (const c of changes) {
    if (c.kind !== "pr" || c.prNumber === undefined || !c.reviewId) continue;
    if (c.prState === undefined && c.reviewDecision === undefined) continue;
    try {
      const snap = ctx.reviews.getSnapshot(c.reviewId);
      if (!snap || !snap.description || snap.description.source !== "pr") continue;
      let rawState: string | undefined;
      let isDraft = false;
      if (c.prState !== undefined) {
        switch (c.prState) {
          case "draft":
            rawState = "OPEN";
            isDraft = true;
            break;
          case "open":
            rawState = "OPEN";
            isDraft = false;
            break;
          case "merged":
            rawState = "MERGED";
            isDraft = false;
            break;
          case "closed":
            rawState = "CLOSED";
            isDraft = false;
            break;
        }
      }
      const curState = snap.description.state;
      const curDraft = snap.description.isDraft ?? false;
      const curDecision = snap.description.reviewDecision;
      const wantDecision = c.reviewDecision;
      const stateSame = rawState === undefined || (curState === rawState && curDraft === isDraft);
      if (stateSame && curDecision === wantDecision) continue;
      await ctx.reviews.mutate(c.reviewId, (draft) => {
        if (!draft.description) return;
        if (rawState !== undefined) {
          draft.description.state = rawState;
          draft.description.isDraft = isDraft;
        }
        if (wantDecision !== undefined) draft.description.reviewDecision = wantDecision;
        else delete draft.description.reviewDecision;
      });
    } catch {
      // One review failing to sync never fails the listing.
    }
  }
}

/**
 * `POST /api/repos` with a URL (#27): clone into the data dir through the
 * injectable command runner, then remember the repo like any other, marked
 * `managed`. The request holds open while the (blobless) clone runs; the
 * service has no repo-scoped progress channel (see `repos/managed.ts`).
 * Adding the same URL twice reuses the existing clone.
 */
async function addRepoByUrl(
  ctx: ServiceContext,
  rawUrl: string,
  reply: FastifyReply,
) {
  let parsed: { owner: string; name: string; prNumber?: number };
  try {
    parsed = parseGitHubRepoInput(rawUrl);
  } catch (err) {
    return reply.code(400).send({ error: (err as Error).message });
  }
  const { owner, name } = parsed;
  try {
    const { repo } = await addManagedRepo(
      { runner: ctx.runner, dataDir: ctx.dataDir, repos: ctx.repos },
      owner,
      name,
    );
    ctx.repos.touch(repo.id);
    const repos = await listAllRepos(ctx);
    const out: AddRepoResponse = { repos: [{ ...DEMO_REPO }, ...repos] };
    if (parsed.prNumber !== undefined) out.prNumber = parsed.prNumber;
    return out;
  } catch (err) {
    if (err instanceof CloneError) {
      return reply.code(err.status).send({ error: err.message });
    }
    throw err;
  }
}
