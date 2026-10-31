/**
 * Chrome extension contract (#322 part 1).
 *
 * The extension id is pinned by the `key` in `extension/manifest.json`, so
 * unpacked loads always get this id. The service allowlists exactly this
 * origin (`chrome-extension://<id>`) — never a wildcard — for the one
 * endpoint the extension's background worker calls. A different build can
 * be allowlisted instead with `UNVIBE_EXTENSION_ID` on the service.
 */
import { githubPrUrl, parseGitHubRepoInput } from "./repos.js";
import type { IngestStatus } from "./api.js";

export const PINNED_EXTENSION_ID = "fmmhgmdbecooajgmpkmcclidchaekiko";

/** Cookie the web app sets on the service origin; the worker reads it. */
export const TOKEN_COOKIE_NAME = "__unvibe_token";

/** The only service endpoint the extension may call cross-origin. */
export const EXTENSION_PR_STATUS_PATH = "/api/extension/pr-status";

/** #322 part 2 spike: side-panel endpoints, same allowlist + token. */
export const EXTENSION_PANEL_PREFIX = "/api/extension/panel";

/** Chrome extension ids: 32 letters a–p (base16 over a–p). */
export function isExtensionId(value: string): boolean {
  return /^[a-p]{32}$/.test(value);
}

export function extensionOrigin(id: string): string {
  return `chrome-extension://${id}`;
}

/**
 * True when `value` is exactly `chrome-extension://<an allowed id>` — no
 * path, port, userinfo or look-alike id. Absent values are not extension
 * origins (callers decide what absence means).
 */
export function isAllowedExtensionOrigin(
  value: string | string[] | undefined,
  allowedIds: readonly string[],
): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return false;
  return allowedIds.some((id) => isExtensionId(id) && raw === extensionOrigin(id));
}

export interface ParsedPrUrl {
  owner: string;
  name: string;
  prNumber: number;
  /** Canonical `https://github.com/<owner>/<name>/pull/<n>`. */
  url: string;
}

/**
 * Deep-link parser for `/open?pr=<url>` (#322): a GitHub PR URL (subpaths
 * like `/files` are ignored, as in `parseGitHubRepoInput`). Anything else
 * — repo URLs, issue URLs, other hosts, missing numbers — throws.
 */
export function parseOpenPrUrl(raw: string | null | undefined): ParsedPrUrl {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("missing pr: expected /open?pr=https://github.com/owner/name/pull/123");
  }
  const ref = parseGitHubRepoInput(raw);
  if (ref.prNumber === undefined) {
    throw new Error(`not a GitHub PR URL: "${raw.trim()}" (expected https://github.com/owner/name/pull/123)`);
  }
  return {
    owner: ref.owner,
    name: ref.name,
    prNumber: ref.prNumber,
    url: githubPrUrl(ref.owner, ref.name, ref.prNumber),
  };
}

/** `/open?pr=<url>` path on the service origin, for the extension worker. */
export function openPrPath(prUrl: string): string {
  return `/open?pr=${encodeURIComponent(prUrl)}`;
}

/** `GET /api/extension/pr-status?pr=<url>` response. */
export interface PrReviewStatusResponse {
  exists: boolean;
  /** Present when `exists`. */
  reviewId?: string;
  /** Ingest state of the existing review, when it exists. */
  status?: IngestStatus["status"];
  /** Canonical PR URL that was looked up. */
  prUrl: string;
}
