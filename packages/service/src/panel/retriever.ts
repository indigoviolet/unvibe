/**
 * Spike retriever (#322 part 2 pilot): the read-only, multi-repo reader
 * that stands in for the agent turn in the prototype. It walks ONLY the
 * active repos' worktrees, records every file it reads, and returns
 * hits the caller turns into repo-qualified citations. The production
 * build swaps this for a real AgentRunner turn scoped the same way
 * (design doc §1); the lockdown guard below is the part that carries over.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import {
  questionTerms, repoCodeCitation, repoSlug, reposUsed,
  type ActiveRepoRef, type RepoHit,
} from "@unvibe/shared";

const SKIP = new Set([".git", "node_modules", "dist", ".next", "coverage"]);
const MAX_FILES = 400;
const MAX_FILE_BYTES = 200_000;
const MAX_HITS_PER_REPO = 4;

/** Lockdown: resolved path must stay inside the repo worktree. */
export function assertInsideRepo(repoRoot: string, candidate: string): string {
  const root = realpathSync(repoRoot);
  const resolved = realpathSync(candidate);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`path is outside the active repo worktree: ${candidate}`);
  }
  return resolved;
}

function walk(dir: string, root: string, out: string[]): void {
  if (out.length >= MAX_FILES) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= MAX_FILES) return;
    if (e.name.startsWith(".") && e.name !== ".") { if (SKIP.has(e.name)) continue; }
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, root, out);
    else if (e.isFile()) out.push(p);
  }
}

export interface RetrievalResult {
  hits: RepoHit[];
  reads: { slug: string; path: string }[];
  reposUsed: string[];
  answer: string;
  citations: string[];
}

/**
 * Read across ALL active repos for one question. A repo is "used" only
 * when a term actually matched inside its worktree — that is the pilot's
 * evidence that multi-repo selection happened, not a prompt claim.
 */
export function retrieveAcrossRepos(repos: readonly ActiveRepoRef[], question: string, selection = ""): RetrievalResult {
  const terms = questionTerms(question, selection);
  const hits: RepoHit[] = [];
  const reads: { slug: string; path: string }[] = [];
  for (const repo of repos) {
    const slug = repoSlug(repo);
    const files: string[] = [];
    try { walk(repo.localPath, repo.localPath, files); } catch { continue; }
    let repoHits = 0;
    for (const file of files) {
      if (repoHits >= MAX_HITS_PER_REPO) break;
      let safe: string;
      try { safe = assertInsideRepo(repo.localPath, file); } catch { continue; }
      let st; try { st = statSync(safe); } catch { continue; }
      if (st.size > MAX_FILE_BYTES) continue;
      let text: string;
      try { text = readFileSync(safe, "utf8"); } catch { continue; }
      if (text.includes("\0")) continue;
      reads.push({ slug, path: path.relative(repo.localPath, safe) });
      const lines = text.split("\n");
      for (let i = 0; i < lines.length && repoHits < MAX_HITS_PER_REPO; i++) {
        if (terms.some((t) => lines[i].includes(t))) {
          hits.push({ repoId: repo.id, slug, path: path.relative(repo.localPath, safe), line: i + 1, text: lines[i].trim().slice(0, 200) });
          repoHits++;
        }
      }
    }
  }
  const citations = hits.map((h) => repoCodeCitation({ owner: h.slug.split("/")[0], name: h.slug.split("/")[1] }, h.path, h.line, h.line));
  const used = reposUsed(hits);
  const answer = hits.length === 0
    ? `No matches in the active repos (${repos.map(repoSlug).join(", ") || "none"}) for: ${question}. Add the repo to Active repos, or rephrase with a symbol or file name.`
    : [
        `Found evidence in ${used.join(" and ")}:`,
        ...hits.map((h, i) => `- ${h.text} [${citations[i]}]`),
        `Repos used: ${used.join(", ")}.`,
      ].join("\n");
  return { hits, reads, reposUsed: used, answer, citations };
}
