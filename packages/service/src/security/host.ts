/**
 * DNS-rebinding and cross-site request defenses (PRD §14, hardening).
 *
 * The service binds loopback only and requires a per-install token, but
 * without origin checks a DNS-rebinding page (attacker host resolving to
 * 127.0.0.1) or a cross-site page could still reach the port:
 * - a top-level navigation sends `SameSite=Lax` cookies, and
 * - a cross-site WebSocket handshake carries the attacker's `Origin`.
 *
 * The token (Bearer/localStorage, never readable cross-origin) is the real
 * gate; these checks are defense in depth so a request that is not even
 * addressed to this machine never reaches a handler:
 * - `Host` must be exactly one loopback name (`127.0.0.1`, `localhost`,
 *   `unvibe.localhost`, `::1`, `::ffff:127.0.0.1`, with or without port).
 *   The match is exact, never a suffix or substring: look-alikes such as
 *   `evil-unvibe.localhost` or `unvibe.localhost.evil.example` are
 *   rejected, as is a trailing dot (`unvibe.localhost.`). Names compare
 *   case-insensitively (DNS names are case-insensitive, RFC 4343), exactly
 *   as before for the other entries.
 * - `Origin`/`Referer`, when present (browsers always send one of them on
 *   cross-site subresource loads and WebSocket handshakes), must be an
 *   `http(s)` origin on one of the same names. The check is deliberately
 *   port-agnostic, as before: the service cannot reliably know its public
 *   port (ephemeral `UNVIBE_PORT=0` binds, tunnels), and pinning it 403s
 *   the app's own asset loads with a blank page. An attacker cannot mint
 *   one of these names as an `Origin` from a victim's browser, so the
 *   exact-name match is the whole defence. Non-browser clients send
 *   neither header and are unaffected (the token still applies).
 */

import { isAllowedExtensionOrigin } from "@unvibe/shared";

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  // Issue #108: the bookmarkable name. Browsers resolve `*.localhost`
  // to loopback themselves (no DNS, no hosts edit); the gate accepts
  // exactly this name, nothing under or around it.
  "unvibe.localhost",
  "::1",
  "::ffff:127.0.0.1",
]);

/** Host header value (optionally with port / IPv6 brackets) → loopback? */
export function isLoopbackHost(host: string | string[] | undefined): boolean {
  const raw = Array.isArray(host) ? host[0] : host;
  if (!raw) return false;
  let h = raw.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end < 0) return false;
    h = h.slice(1, end);
  } else if (h.indexOf(":") === h.lastIndexOf(":") && h.includes(":")) {
    // Single colon: host:port. Bare IPv6 (multiple colons) falls through.
    h = h.slice(0, h.indexOf(":"));
  }
  return LOOPBACK_HOSTS.has(h);
}

/**
 * One `Origin`/`Referer` value → loopback http(s) origin, or absent (allow:
 * non-browser clients send neither; the install token still applies).
 */
export function isAllowedOrigin(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return true;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // URL keeps IPv6 brackets on hostname ("[::1]"); strip them.
  const name = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return LOOPBACK_HOSTS.has(name);
}

export interface HostCheckRequest {
  headers: Record<string, string | string[] | undefined>;
}

export interface HostCheckOptions {
  /**
   * #322: exact `chrome-extension://<id>` origins allowed for this one
   * request (the extension pr-status endpoint only). Never a wildcard:
   * every other endpoint keeps the loopback-only rule, so an extension
   * origin anywhere else is still refused.
   */
  extensionIds?: readonly string[];
  /**
   * #322 fix: skip the Origin/Referer check for this one request (the
   * read-only `GET /open`, so a cross-site link still lands on the
   * in-app confirm page instead of a bare 403). The Host must still be
   * loopback, the token gate still applies, and the endpoint this
   * relaxes must never mutate — the mutation is a separate POST behind
   * the full gate.
   */
  relaxedOrigin?: boolean;
}

/** Combined gate for the service `onRequest` hook. */
export function hostCheckAllows(
  req: HostCheckRequest,
  opts: HostCheckOptions = {},
): { ok: true } | { ok: false; reason: string } {
  if (!isLoopbackHost(req.headers["host"])) return { ok: false, reason: "host is not loopback" };
  if (opts.relaxedOrigin) return { ok: true };
  const ext = opts.extensionIds ?? [];
  const originOk =
    isAllowedOrigin(req.headers["origin"]) || isAllowedExtensionOrigin(req.headers["origin"], ext);
  if (!originOk) return { ok: false, reason: "origin is not loopback" };
  const refererOk =
    isAllowedOrigin(req.headers["referer"]) || isAllowedExtensionOrigin(req.headers["referer"], ext);
  if (!refererOk) return { ok: false, reason: "referer is not loopback" };
  return { ok: true };
}
