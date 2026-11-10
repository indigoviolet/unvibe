/**
 * Copy-as-Markdown wiring (issue #377).
 *
 * The review's repo (owner/name for permalink citations) is fetched once
 * per review and cached in the module: every card and every thread reply
 * renders a copy button, and they must not each hit the API. Copying
 * itself is `navigator.clipboard.writeText` + the shared toast idiom
 * (the same success/failure shape as the Outbox Markdown copy).
 */
import { useEffect, useState } from "react";
import {
  contextFromSnapshot,
  type CopyMarkdownContext,
  type CopyMarkdownPage,
  type ReviewSnapshot,
} from "@unvibe/shared";
import { api } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";

export interface GithubRepo {
  owner: string;
  name: string;
}

const repoCache = new Map<string, GithubRepo | null>();
const repoInflight = new Map<string, Promise<GithubRepo | null>>();

/**
 * The repo behind a review (owner/name for permalink citations). Local
 * checkouts (`owner: "local"`) and unknown repos resolve to null, which
 * renders plain `path:lines` citations. The demo resolves through the
 * repos list like the selection toolbar's GitHub action does.
 */
export function fetchGithubRepo(reviewId: string, fallbackRepoId: string): Promise<GithubRepo | null> {
  const cached = repoCache.get(reviewId);
  if (cached !== undefined) return Promise.resolve(cached);
  const running = repoInflight.get(reviewId);
  if (running) return running;
  const task = api
    .reviews()
    .then(
      (rs) => rs.reviews.find((r) => r.id === reviewId)?.repoId ?? fallbackRepoId,
      () => fallbackRepoId,
    )
    .then((repoId: string) => api.repos().then((r) => ({ repoId, repos: r.repos })))
    .then(({ repoId, repos }) => {
      const found = repos.find((x) => x.id === repoId);
      const repo: GithubRepo | null =
        found && found.owner !== "local" ? { owner: found.owner, name: found.name } : null;
      repoCache.set(reviewId, repo);
      repoInflight.delete(reviewId);
      return repo;
    })
    .catch(() => {
      repoInflight.delete(reviewId);
      return null;
    });
  repoInflight.set(reviewId, task);
  return task;
}

/** The review's repo for copy citations (null while loading or for local reviews). */
export function useGithubRepo(): GithubRepo | null {
  const reviewId = useReview((s) => s.snapshot?.review.id);
  const repoId = useReview((s) => s.snapshot?.review.repoId);
  const [repo, setRepo] = useState<GithubRepo | null>(() =>
    reviewId && repoCache.has(reviewId) ? (repoCache.get(reviewId) ?? null) : null,
  );
  useEffect(() => {
    if (!reviewId || !repoId) {
      setRepo(null);
      return;
    }
    if (repoCache.has(reviewId)) {
      setRepo(repoCache.get(reviewId) ?? null);
      return;
    }
    let dead = false;
    void fetchGithubRepo(reviewId, repoId).then((r) => {
      if (!dead) setRepo(r);
    });
    return () => {
      dead = true;
    };
  }, [reviewId, repoId]);
  return repo;
}

/** Page lookup for finding-link rendering (title/confidence/summary). */
export function findPageIn(snapshot: ReviewSnapshot): (pageId: string) => CopyMarkdownPage | null {
  return (pageId: string) => {
    const page = snapshot.pages.find((p) => p.id === pageId);
    return page ? { title: page.title, confidence: page.confidence, summary: page.summary } : null;
  };
}

/** Converter context for the current snapshot + repo. */
export function copyContextFor(
  snapshot: ReviewSnapshot,
  repo: GithubRepo | null,
): { ctx: CopyMarkdownContext; findPage: (pageId: string) => CopyMarkdownPage | null } {
  return { ctx: contextFromSnapshot(snapshot, repo), findPage: findPageIn(snapshot) };
}

/** Copy Markdown to the clipboard with the shared toast idiom. */
export function copyMarkdownText(markdown: string): void {
  navigator.clipboard
    .writeText(markdown)
    .then(() => toast("Copied as Markdown"))
    .catch(() => toast("Couldn't copy to the clipboard"));
}
