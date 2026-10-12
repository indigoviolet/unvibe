/**
 * GitHub repo reference parsing for "add a repo by URL" (#27).
 *
 * Pure logic (no Node or DOM APIs): the service and the web share it, so a
 * pasted URL means the same thing on both sides. The service validates again
 * server-side; this module is the single definition of what counts.
 *
 * Accepted (owner/name are validated, see below):
 * - `https://github.com/owner/name` (http too), optional `.git` suffix and
 *   trailing slash, query/fragment ignored
 * - `git@github.com:owner/name.git` (scp form) and
 *   `ssh://git@github.com/owner/name[.git]`
 * - bare `owner/name`
 * - a PR URL `https://github.com/owner/name/pull/123` (trailing path like
 *   `/files` ignored): yields owner/name plus the PR number for the later
 *   web step (paste-PR-offers-to-add).
 * - bare `owner/name#123`: the start page's short PR form, same yield.
 *
 * Rejected with a clear message: anything else (non-github.com hosts,
 * `owner/name/extra`, issue URLs, empty segments, …). Only `github.com`
 * (and `www.github.com`) is accepted: managed clones authenticate through
 * the user's `gh` login, which targets github.com.
 *
 * Owner/name validation doubles as path/command safety: both must match
 * GitHub's allowed characters, so they are safe as path segments under
 * `<dataDir>/repos` (no `..`, no separators, no leading dots) and safe as
 * `gh` command arguments (nothing starting with `-`).
 */

export interface ParsedRepoRef {
  owner: string;
  name: string;
  /** Present when the input was a PR URL. */
  prNumber?: number;
}
/**
 * GitHub login: alphanumerics and hyphens, 1–39 chars, never leading or
 * trailing hyphen (github.com/join rules, lower bound relaxed to 1).
 */
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/**
 * GitHub repo name: alphanumerics plus `.`, `-`, `_`. Must start with an
 * alphanumeric or `_` (never `-`, which would read as a CLI flag, and never
 * `.`, which would hide the checkout directory) and must not end with `.`.
 * `..` parent escapes are impossible under this grammar.
 */
const NAME_RE = /^[A-Za-z0-9_](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;

const MAX_OWNER_LEN = 39;
const MAX_NAME_LEN = 100;

function checkOwner(owner: string, input: string): void {
  if (owner.length > MAX_OWNER_LEN || !OWNER_RE.test(owner)) {
    throw new Error(
      `invalid owner "${owner}" in "${input}": GitHub owners use letters, numbers and hyphens (never leading or trailing)`,
    );
  }
}

function checkName(name: string, input: string): void {
  if (name.length > MAX_NAME_LEN || !NAME_RE.test(name)) {
    throw new Error(
      `invalid repo name "${name}" in "${input}": GitHub repo names use letters, numbers, ".", "-" and "_" (never starting with "-" or ".")`,
    );
  }
}

/** Strip one trailing `.git` (clone URLs) — `name.git` means repo `name`. */
function stripDotGit(name: string): string {
  return name.endsWith(".git") && name.length > 4 ? name.slice(0, -4) : name;
}

function checked(owner: string, name: string, input: string, prNumber?: number): ParsedRepoRef {
  checkOwner(owner, input);
  checkName(stripDotGit(name), input);
  const out: ParsedRepoRef = { owner, name: stripDotGit(name) };
  if (prNumber !== undefined) out.prNumber = prNumber;
  return out;
}

function parsePrNumber(seg: string, input: string): number {
  if (!/^[1-9][0-9]*$/.test(seg)) {
    throw new Error(`invalid PR number in "${input}": expected https://github.com/owner/name/pull/<number>`);
  }
  return Number(seg);
}

/**
 * Parse a pasted repo reference. Returns owner/name (+ PR number for PR
 * URLs); throws an `Error` with a human-readable message otherwise. The
 * message is surfaced verbatim through the service's `{ error }` body and
 * `friendlyError`, so it says what to paste instead.
 */
export function parseGitHubRepoInput(raw: string): ParsedRepoRef {
  const input = raw.trim();
  if (input === "") {
    throw new Error("enter a GitHub repo URL or owner/name (e.g. https://github.com/acme/app or acme/app)");
  }

  // scp form: git@github.com:owner/name(.git)
  const scp = input.match(/^[\w.-]+@([^:]+):(.+)$/);
  if (scp) {
    const host = scp[1].toLowerCase();
    if (host !== "github.com") {
      throw new Error(`only github.com repos are supported (got "${scp[1]}")`);
    }
    const segs = scp[2].split("/").filter((s) => s !== "");
    if (segs.length !== 2) {
      throw new Error(`not a GitHub repo URL or owner/name: "${input}" (try owner/name or https://github.com/owner/name)`);
    }
    return checked(segs[0], segs[1], input);
  }

  // URL form: [scheme://][host/]owner/name[/...]
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
  if (withScheme || input.includes("://")) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new Error(`not a GitHub repo URL or owner/name: "${input}" (try owner/name or https://github.com/owner/name)`);
    }
    const scheme = url.protocol.toLowerCase();
    if (scheme !== "https:" && scheme !== "http:" && scheme !== "ssh:" && scheme !== "git:") {
      throw new Error(`not a GitHub repo URL or owner/name: "${input}" (try owner/name or https://github.com/owner/name)`);
    }
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") {
      throw new Error(`only github.com repos are supported (got "${url.hostname}")`);
    }
    const segs = url.pathname.split("/").filter((s) => s !== "");
    if (segs.length === 2) {
      return checked(segs[0], segs[1], input);
    }
    if (segs.length >= 4 && segs[2].toLowerCase() === "pull") {
      const prNumber = parsePrNumber(segs[3], input);
      const ref = checked(segs[0], segs[1], input);
      return { ...ref, prNumber };
    }
    throw new Error(
      `not a GitHub repo URL or owner/name: "${input}" (try https://github.com/owner/name, owner/name, or a PR URL like https://github.com/owner/name/pull/123)`,
    );
  }

  // Bare owner/name (also tolerates a pasted path with a trailing slash),
  // or owner/name#N (a PR in that repo — the start page's offer flow and
  // the service's add-then-open step share this form).
  // Leading `/`, `.` or `~` means a local path was pasted as a URL.
  if (/^[/.~]/.test(input)) {
    throw new Error(`"${input}" looks like a local path, not a GitHub URL — add it by path instead`);
  }
  const hash = input.match(/^([^/\s#]+)\/([^/\s#]+)#(\d+)$/);
  if (hash) {
    const prNumber = parsePrNumber(hash[3], input);
    const ref = checked(hash[1], hash[2], input);
    return { ...ref, prNumber };
  }
  const segs = input.split("/").filter((s) => s !== "");
  if (segs.length === 2 && !input.includes(":") && !input.includes(" ") && !input.includes("?") && !input.includes("#")) {
    return checked(segs[0], segs[1], input);
  }
  throw new Error(
    `not a GitHub repo URL or owner/name: "${input}" (try https://github.com/owner/name, owner/name, or a PR URL like https://github.com/owner/name/pull/123)`,
  );
}
