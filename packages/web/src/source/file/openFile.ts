/**
 * Open a file at a commit in the source pane (#81) — the reusable entry
 * point for showing code outside the PR diff.
 *
 * `openFileAtCommit({ path, commit, start, end })` asks the mounted
 * source pane to open (or re-focus) the tab for that file at that
 * commit, scrolled to the cited lines. It assumes nothing about a PR
 * diff: the pane serves the content through
 * `GET /api/reviews/:id/file?path=&commit=&start=&end=` (the same
 * `git show` source as `get_code`), so any caller with a review open —
 * a `code:` citation today, a document review's context-repo citation
 * (#222) tomorrow — calls this one function with a repo-relative path,
 * a commit, and an optional 1-based line range.
 *
 * One tab per opened file (keyed by path + commit), each with a close
 * button. A range past the end of the file highlights whatever part of
 * it exists.
 */
import { parseId } from "@unvibe/shared";

export interface OpenFileRequest {
  /** Repo-relative path. */
  path: string;
  /** Commit the tab shows (the citation's pinned SHA). */
  commit: string;
  /** First cited line (1-based), when the caller names one. */
  start?: number;
  /** Last cited line (1-based, inclusive). */
  end?: number;
}

export const OPEN_FILE_EVENT = "unvibe:open-file";

/** Tab identity: one tab per file at a commit. */
export function openFileKey(req: Pick<OpenFileRequest, "path" | "commit">): string {
  return `${req.path}@${req.commit}`;
}

/** Ask the source pane to show this file at this commit. */
export function openFileAtCommit(req: OpenFileRequest): void {
  if (!req.path || !/^[0-9a-fA-F]{4,64}$/.test(req.commit)) return;
  window.dispatchEvent(new CustomEvent<OpenFileRequest>(OPEN_FILE_EVENT, { detail: { ...req } }));
}

/** Open the file a `code:` citation names. False for other targets. */
export function openFileForCitation(target: string, fallbackCommit?: string): boolean {
  const parsed = parseId(target);
  if (!parsed || parsed.kind !== "code") return false;
  const commit = parsed.sha ?? fallbackCommit;
  if (!commit) return false;
  openFileAtCommit({ path: parsed.path, commit, start: parsed.start, end: parsed.end });
  return true;
}
