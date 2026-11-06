/**
 * Trace scrubber (issue #356). Same allowlist-by-construction rule as the
 * #323 stats exporter: a span carries only numbers, fixed enums/safe
 * tokens, and salted HMAC hashes. No code, file contents, reviewed-repo
 * paths, home-folder paths, tokens, PR titles, prompt text, command
 * arguments, environment values, or URLs with review content ever reach a
 * stored span. Absolute wall-clock times are inherent to a trace (they
 * are the product: the waterfall), so span start/end stay; everything
 * else is scrubbed.
 */
import { createHmac, randomBytes } from "node:crypto";

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** True for values safe to store verbatim (numbers and short safe tokens). */
export function isSafeToken(value: string): boolean {
  return SAFE_TOKEN.test(value);
}

/** Salted hasher: one random salt per recorder, never written anywhere. */
export function makeTraceHasher(): (kind: string, value: string) => string {
  const salt = randomBytes(32);
  return (kind, value) =>
    createHmac("sha256", salt).update(`${kind}:${value}`).digest("hex").slice(0, 16);
}

/**
 * Route patterns (`/api/reviews/:id`) are code constants, safe to keep
 * readable. Anything with a space, query string, or backslash is not a
 * pattern and stays hashed.
 */
export function isRoutePattern(value: string): boolean {
  return /^\/[A-Za-z0-9._~:/*-]*$/.test(value);
}

/**
 * Attribute keys whose values are always hashed, even when they look
 * like innocent safe tokens: review/session/repo ids and any path or
 * file reference (#323 hashes every id; a `rv-…` id must never be
 * stored verbatim just because it matches the token grammar).
 */
function isIdLikeKey(key: string): boolean {
  if (key === "review" || key === "session" || key === "repo" || key === "browser.path") return true;
  return (
    key.endsWith(".review") ||
    key.endsWith(".session") ||
    key.endsWith(".repo") ||
    key.endsWith(".path") ||
    key.endsWith(".file")
  );
}

/**
 * Scrub one attribute value for storage. Numbers pass through; strings
 * pass only when they are short safe tokens (enum names, command
 * basenames, route patterns) — except id-like keys, which always hash.
 * Everything else becomes a salted hash so grouping (same file ⇒ same
 * hash within one recording) survives without ever storing the raw value.
 */
export function scrubAttribute(
  hash: (kind: string, value: string) => string,
  key: string,
  value: string | number | boolean,
): string | number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (key === "http.route" && isRoutePattern(value)) return value;
  if (!isIdLikeKey(key) && isSafeToken(value)) return value;
  return hash(key, value);
}
