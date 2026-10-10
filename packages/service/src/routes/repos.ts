/**
 * Start-page repos (PRD §4.2):
 * - `GET /api/repos` — remembered repos (most recent first) plus detected
 *   local checkouts under the configured roots (marked `detected: true`).
 * - `POST /api/repos` — remember a checkout path (validated as a git
 *   checkout; owner/name derived from the `origin` remote).
 * - `GET /api/repos/:id/changes?filter=` — authoring / review-requested
 *   PRs, recent branches, previous reviews with stale state.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type {
  AddRepoRequest,
  ChangesFilter,
  Repo,
  ReposResponse,
  RepoChangesResponse,
} from "@unvibe/shared";
import {
  deriveIdentity,
  detectCheckouts,
  isGitCheckout,
  newRepoId,
  repoChanges,
  resolveRepoRoots,
} from "../repos/index.js";
import type { ServiceContext } from "./context.js";

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

/** GET /api/repos · POST /api/repos · GET /api/repos/:id/changes */
export async function registerRepos(app: FastifyInstance, ctx: ServiceContext): Promise<void> {
  app.get("/api/repos", async () => {
    const repos = await listAllRepos(ctx);
    // Demo first so the start page shows it without tokens (M3).
    return { repos: [{ ...DEMO_REPO }, ...repos] } satisfies ReposResponse;
  });

  app.post("/api/repos", async (req, reply) => {
    const body = req.body as AddRepoRequest | undefined;
    const rawPath = body?.path;
    if (typeof rawPath !== "string" || rawPath.trim() === "") {
      return reply.code(400).send({ error: "path is required" });
    }
    const { default: path } = await import("node:path");
    const localPath = path.resolve(rawPath.trim());
    let ok = false;
    try {
      ok = await isGitCheckout(ctx.runner, localPath);
    } catch {
      ok = false;
    }
    if (!ok) {
      return reply.code(400).send({ error: `not a git checkout: ${localPath}` });
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
    return { repos: [{ ...DEMO_REPO }, ...repos] } satisfies ReposResponse;
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
    const changes = await repoChanges({ runner: ctx.runner, db: ctx.db }, repo, filter);
    return { changes } satisfies RepoChangesResponse;
  });
}
