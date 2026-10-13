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
 *   `http(s)` origin on one of the same names — and, when the gate knows
 *   the service port, on that port (our pages are served from the
 *   service's own origin, so a same-name different-port origin is not one
 *   of ours). Non-browser clients send neither and are unaffected (the
 *   token still applies).
 */

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
 *
 * When `servicePort` is given, an origin that carries an explicit port
 * (or whose scheme implies one) must be on that port: our pages are served
 * from the service's own origin. Omitted (tests, port-agnostic callers)
 * keeps the previous name-only check.
 */
export function isAllowedOrigin(
  value: string | string[] | undefined,
  servicePort?: number,
): boolean {
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
  if (!LOOPBACK_HOSTS.has(name)) return false;
  if (servicePort !== undefined) {
    // Effective port: explicit, else the scheme default (80/443).
    const portText = url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80";
    if (Number(portText) !== servicePort) return false;
  }
  return true;
}

export interface HostCheckRequest {
  headers: Record<string, string | string[] | undefined>;
}

export interface HostCheckOptions {
  /**
   * The service's own port: when given, `Origin`/`Referer` must be on it
   * (see `isAllowedOrigin`). The server wires its configured port;
   * callers without one keep the name-only check.
   */
  servicePort?: number;
}

/** Combined gate for the service `onRequest` hook. */
export function hostCheckAllows(
  req: HostCheckRequest,
  opts: HostCheckOptions = {},
): { ok: true } | { ok: false; reason: string } {
  if (!isLoopbackHost(req.headers["host"])) return { ok: false, reason: "host is not loopback" };
  if (!isAllowedOrigin(req.headers["origin"], opts.servicePort))
    return { ok: false, reason: "origin is not loopback" };
  if (!isAllowedOrigin(req.headers["referer"], opts.servicePort))
    return { ok: false, reason: "referer is not loopback" };
  return { ok: true };
}
