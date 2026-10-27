/**
 * Allowlisted icon pipeline (issue #286, owner decision 2026-10-27).
 *
 * Only `icons.terrastruct.com` (D2's own icon library) is allowed, and only
 * as `https:` URLs with no query or fragment. The pipeline pre-fetches the
 * allowlisted bytes itself (5 s cap, 100 KB cap), stages them next to the
 * source, and rewrites the source to the staged file — d2 embeds local
 * files as `data:` even with `--bundle=false`, so the binary never touches
 * the network (its env is still scrubbed with bogus proxies).
 *
 * An icon that fails to fetch (404 from an invented name, offline, too
 * large) is stripped: the `icon:`/`src:` key is removed and the diagram
 * renders without it. The strip is recorded (`stripped`) so the caller can
 * note the reason where it records render notes (countable miss rate).
 * Anything else (other hosts, query/fragment, non-https, non-svg) is
 * rejected *before compiling* by the pre-check, never fetched.
 *
 * No icon cache and no other mechanism: every render fetches afresh.
 * The fetcher is injectable (`IconFetcher`) so unit tests stub it —
 * tests must not hit the network.
 */

export const ICON_ALLOW_HOST = "icons.terrastruct.com";
export const ICON_FETCH_TIMEOUT_MS = 5_000;
export const ICON_MAX_BYTES = 100 * 1024;

/** One stripped icon: the URL plus why it was dropped. */
export interface IconStrip {
  url: string;
  reason: string;
}

export type IconFetchOk = { ok: true; bytes: Uint8Array };
export type IconFetchFail = { ok: false; reason: string };

/** Fetch one icon URL. Never throws (failures are values). */
export type IconFetcher = (url: string) => Promise<IconFetchOk | IconFetchFail>;

/**
 * Validate one `icon:`/`src:` URL against the allowlist. Pure; never throws.
 * The working form is `https://icons.terrastruct.com/<set>%2F<name>.svg`
 * (`%2F`-escaped; the `/` form 403s).
 */
export function validateIconUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: `icon URL does not parse: ${raw}` };
  }
  if (u.protocol !== "https:") return { ok: false, reason: `icon URL must be https: ${raw}` };
  if (u.host !== ICON_ALLOW_HOST) {
    return { ok: false, reason: `icon host not allowlisted (want ${ICON_ALLOW_HOST}): ${u.host}` };
  }
  if (u.search || u.hash) return { ok: false, reason: `icon URL must have no query or fragment: ${raw}` };
  if (!u.pathname.endsWith(".svg")) return { ok: false, reason: `icon URL must end in .svg: ${raw}` };
  return { ok: true };
}

/** Match an `icon:` or `src:` key and capture its raw (possibly quoted) value. */
const ICON_KEY_RE = /(?<![\w-])(icon|src)\s*:\s*("[^"]*"|'[^']*'|[^\s;},]+)/gi;

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Every distinct `icon:`/`src:` URL in the source (first-seen order). */
export function extractIconUrls(source: string): string[] {
  const out: string[] = [];
  ICON_KEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ICON_KEY_RE.exec(source)) !== null) {
    const url = unquote(m[2]);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

/** Default fetcher: real network with a timeout and a size cap. Never throws. */
export async function defaultFetchIcon(url: string): Promise<IconFetchOk | IconFetchFail> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ICON_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} for ${url}` };
    const len = res.headers.get("content-length");
    if (len !== null && Number(len) > ICON_MAX_BYTES) {
      try {
        await res.body?.cancel();
      } catch {
        // best effort
      }
      return { ok: false, reason: `icon too large (${len}B): ${url}` };
    }
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, reason: `icon has no body: ${url}` };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > ICON_MAX_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // best effort
        }
        return { ok: false, reason: `icon too large (>${ICON_MAX_BYTES}B): ${url}` };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
    return { ok: true, bytes };
  } catch (e) {
    return { ok: false, reason: `fetch failed (${(e as Error).message}): ${url}` };
  }
}

export interface StagedIcons {
  /** Source with staged icons rewritten to `./icon-<n>.svg`, failed ones stripped. */
  source: string;
  /** URLs fetched and staged (parallel to the `./icon-<n>.svg` filenames). */
  staged: { url: string; file: string }[];
  /** URLs stripped instead of rendered, with reasons. */
  stripped: IconStrip[];
}

/**
 * Pre-fetch every `icon:`/`src:` URL, stage the bytes into `dir`, and
 * rewrite the source to the staged files; strip (and record) failures.
 * Assumes the URLs already passed `validateIconUrl` (the pre-check runs
 * first); a URL that fails validation here is stripped, never fetched.
 * Never throws (filesystem failures strip too).
 */
export async function stageIcons(
  source: string,
  opts: { fetcher?: IconFetcher; dir: string },
): Promise<StagedIcons> {
  const fetcher = opts.fetcher ?? defaultFetchIcon;
  const urls = extractIconUrls(source);
  const staged: { url: string; file: string }[] = [];
  const stripped: IconStrip[] = [];
  const stagedByUrl = new Map<string, string>();

  for (const url of urls) {
    const valid = validateIconUrl(url);
    if (!valid.ok) {
      stripped.push({ url, reason: (valid as { ok: false; reason: string }).reason });
      continue;
    }
    const fetched = await fetcher(url).catch((e: Error) => ({
      ok: false as const,
      reason: `fetch failed (${e.message}): ${url}`,
    }));
    if (!fetched.ok) {
      stripped.push({ url, reason: (fetched as IconFetchFail).reason });
      continue;
    }
    const file = `icon-${staged.length}.svg`;
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      fs.writeFileSync(path.join(opts.dir, file), fetched.bytes);
    } catch (e) {
      stripped.push({ url, reason: `stage failed (${(e as Error).message}): ${url}` });
      continue;
    }
    staged.push({ url, file });
    stagedByUrl.set(url, file);
  }

  // Rewrite in one pass over the key matches (quoted or bare values):
  // staged URLs point at the staged file, stripped ones lose the whole key.
  const dropped = new Set(stripped.map((s) => s.url));
  ICON_KEY_RE.lastIndex = 0;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = ICON_KEY_RE.exec(source)) !== null) {
    const url = unquote(m[2]);
    const file = stagedByUrl.get(url);
    if (!file && !dropped.has(url)) continue;
    out += source.slice(last, m.index);
    last = m.index + m[0].length;
    if (file) out += `${m[1]}: "./${file}"`;
    // Stripped: emit nothing (the key goes away entirely).
  }
  out += source.slice(last);
  // Clean up keys left dangling by the strip: `{, b: 1}` → `{b: 1}`,
  // `{a: 1,}` → `{a: 1}`.
  out = out.replace(/\{\s*,\s*/g, "{").replace(/\s*,\s*\}/g, "}");
  return { source: out, staged, stripped };
}
