/**
 * ID grammar (PRD §7.2).
 *
 * ```
 * diff:<fileKey>:<line>[-<line>]@<headSha>   new-side lines in the change
 * h:<fileKey>:<contentHash>                  a hunk (stable across versions)
 * code:<path>:<line>[-<line>]@<sha>          any code at a commit
 * desc:<paragraph>@<rev>                     description paragraph
 * card:<cardId>[#<blockId>]                  guide content (cardId is a
 *                                            page-card id, or an expansion
 *                                            annotation id for content
 *                                            inside an explanation, #116)
 * page:<pageId>                              a page
 * concept:<slug>                             a concept (may be a hidden candidate)
 * ann:<id>                                   an annotation
 * ```
 *
 * Short forms: within one version the UI and prompts may drop the `@<sha>`
 * suffix (diff/code) or `@<rev>` suffix (desc). Stored references always
 * keep the suffix. `parseId` accepts both; `formatId` emits the full form
 * unless `{ short: true }` is passed.
 *
 * Card and block IDs stay the same across revisions: a reference always
 * means the latest version.
 */

export type ParsedId =
  | { kind: "diff"; fileKey: string; start: number; end: number; sha?: string }
  | { kind: "h"; fileKey: string; contentHash: string }
  | { kind: "code"; path: string; start: number; end: number; sha?: string }
  | { kind: "desc"; paragraph: string; rev?: string }
  | { kind: "card"; cardId: string; blockId?: string }
  | { kind: "page"; pageId: string }
  | { kind: "concept"; slug: string }
  | { kind: "ann"; id: string };

const SHA = "[0-9a-fA-F]{4,64}";
const LINE_RANGE = "(\\d+)(?:-(\\d+))?";

function parseLineRange(s: string): { start: number; end: number } | null {
  const m = s.match(new RegExp(`^${LINE_RANGE}$`));
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] !== undefined ? Number(m[2]) : start;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    return null;
  }
  return { start, end };
}

function splitSha(s: string): { head: string; sha?: string } {
  const at = s.lastIndexOf("@");
  if (at < 0) return { head: s };
  return { head: s.slice(0, at), sha: s.slice(at + 1) };
}

/**
 * Parse an ID string. Returns `null` when the string is not a valid ID.
 * Accepts short forms (missing `@sha` / `@rev`).
 */
export function parseId(input: string): ParsedId | null {
  if (!input || input.length > 1024) return null;
  const colon = input.indexOf(":");
  if (colon < 0) return null;
  const kind = input.slice(0, colon);
  const rest = input.slice(colon + 1);
  if (!rest) return null;

  switch (kind) {
    case "diff": {
      // diff:<fileKey>:<line>[-<line>][@<sha>]; fileKey has no colon.
      const m = rest.match(new RegExp(`^([^:@]+):(\\d+(?:-\\d+)?)(?:@(${SHA}))?$`));
      if (!m) return null;
      const range = parseLineRange(m[2]);
      if (!range) return null;
      return { kind: "diff", fileKey: m[1], ...range, sha: m[3] };
    }
    case "h": {
      const m = rest.match(/^([^:@]+):([^:@]+)$/);
      if (!m || !m[2]) return null;
      return { kind: "h", fileKey: m[1], contentHash: m[2] };
    }
    case "code": {
      // code:<path>:<lines>[@<sha>]; path may contain colons → split from right.
      const { head, sha } = splitSha(rest);
      if (sha !== undefined && !new RegExp(`^${SHA}$`).test(sha)) return null;
      const m = head.match(/^(.*):(\d+(?:-\d+)?)$/);
      if (!m || !m[1]) return null;
      const range = parseLineRange(m[2]);
      if (!range) return null;
      return { kind: "code", path: m[1], ...range, sha };
    }
    case "desc": {
      const m = rest.match(/^([^:@]+)(?:@([^:@]+))?$/);
      if (!m) return null;
      return { kind: "desc", paragraph: m[1], rev: m[2] };
    }
    case "card": {
      const m = rest.match(/^([^:#@]+)(?:#([^:#@]+))?$/);
      if (!m) return null;
      return { kind: "card", cardId: m[1], blockId: m[2] };
    }
    case "page": {
      if (/[:#@]/.test(rest)) return null;
      return { kind: "page", pageId: rest };
    }
    case "concept": {
      if (/[:#@]/.test(rest)) return null;
      return { kind: "concept", slug: rest };
    }
    case "ann": {
      if (/[:#@]/.test(rest)) return null;
      return { kind: "ann", id: rest };
    }
    default:
      return null;
  }
}

/**
 * Rewrite an alias-form target to its canonical form (real file key),
 * preserving the short shape (no `@sha` is added). Non-file targets and
 * unparseable inputs come back unchanged. The pipeline stores canonical
 * targets at parse/validate time so the web needs no alias table.
 */
export function canonicalizeTarget(
  target: string,
  resolveFileKey: (key: string) => string | null,
): string {
  const parsed = parseId(target);
  if (parsed?.kind !== "diff" && parsed?.kind !== "h") return target;
  const canonical = resolveFileKey(parsed.fileKey);
  if (canonical === null || canonical === parsed.fileKey) return target;
  if (parsed.kind === "h") return `h:${canonical}:${parsed.contentHash}`;
  return formatId({ ...parsed, fileKey: canonical });
}

/** Format a parsed ID back to its canonical (full) string form. */
export function formatId(id: ParsedId, opts?: { short?: boolean }): string {
  const short = opts?.short ?? false;
  switch (id.kind) {
    case "diff": {
      const range = id.start === id.end ? `${id.start}` : `${id.start}-${id.end}`;
      const base = `diff:${id.fileKey}:${range}`;
      return short || !id.sha ? base : `${base}@${id.sha}`;
    }
    case "h":
      return `h:${id.fileKey}:${id.contentHash}`;
    case "code": {
      const range = id.start === id.end ? `${id.start}` : `${id.start}-${id.end}`;
      const base = `code:${id.path}:${range}`;
      return short || !id.sha ? base : `${base}@${id.sha}`;
    }
    case "desc": {
      // desc short form drops @rev; full form requires rev — if missing, emit bare.
      const base = `desc:${id.paragraph}`;
      return short || !id.rev ? base : `${base}@${id.rev}`;
    }
    case "card":
      return id.blockId ? `card:${id.cardId}#${id.blockId}` : `card:${id.cardId}`;
    case "page":
      return `page:${id.pageId}`;
    case "concept":
      return `concept:${id.slug}`;
    case "ann":
      return `ann:${id.id}`;
  }
}
