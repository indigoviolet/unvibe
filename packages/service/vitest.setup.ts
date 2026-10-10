/**
 * Network guarantee harness (PRD §16 Privacy).
 *
 * The entire service suite runs under this: outbound sockets fail unless
 * the destination is loopback, so any test that makes Unvibe's own code
 * contact the outside fails loudly. The user's own tools (`gh`, `git`,
 * agent CLIs) run as subprocesses and are unaffected (only sockets from
 * this process are guarded).
 *
 * Wrapped: `net.Socket.prototype.connect`, `tls.connect`, `dns.lookup`,
 * global `fetch`. Non-loopback attempts are recorded on
 * `globalThis.__unvibeNonLoopbackAttempts` (asserted empty by the demo
 * end-to-end test) and then fail.
 *
 * Loopback = 127.0.0.1, ::1, ::ffff:127.0.0.1, localhost. Unix-socket
 * connects (no host) are allowed.
 */
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";

declare global {
  // eslint-disable-next-line no-var
  var __unvibeNonLoopbackAttempts: string[] | undefined;
}

function attempts(): string[] {
  if (!globalThis.__unvibeNonLoopbackAttempts) globalThis.__unvibeNonLoopbackAttempts = [];
  return globalThis.__unvibeNonLoopbackAttempts;
}

function isLoopbackHost(host: string | undefined | null): boolean {
  if (!host) return true; // Unix socket / unspecified: allow.
  const h = host.toLowerCase();
  return (
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "::ffff:127.0.0.1" ||
    h === "localhost" ||
    h === "ip6-localhost"
  );
}

function record(kind: string, detail: string): void {
  try {
    attempts().push(`${kind}: ${detail}`);
  } catch {
    // Never break the suite for bookkeeping.
  }
}

function hostOfUrl(url: string | URL): string {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return "";
  }
}

// --- net.Socket.prototype.connect ---------------------------------------
const origConnect = net.Socket.prototype.connect;
(net.Socket.prototype as unknown as Record<string, unknown>).connect = function (
  this: net.Socket,
  ...args: unknown[]
): net.Socket {
  // Overloads: connect(port[, host][, cb]), connect(options[, cb]), connect(path[, cb]).
  let host: string | undefined;
  const first = args[0] as unknown;
  if (typeof first === "object" && first !== null && !Array.isArray(first)) {
    host = (first as { host?: string; hostname?: string }).host ?? (first as { hostname?: string }).hostname;
    // Strip port if host includes it ("127.0.0.1:4517" shouldn't happen here, but be safe).
    if (host && host.includes(":") && !host.includes("::")) host = host.split(":")[0];
  } else if (typeof args[1] === "string") {
    host = args[1] as string;
  } else if (typeof first === "string" && (first as string).includes("/")) {
    return (origConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  }
  // Default host for connect(port) with no host is 127.0.0.1? Actually
  // Node defaults to localhost — treat missing as loopback (allow).
  if (host !== undefined && !isLoopbackHost(host)) {
    record("net.connect", host);
    const err = new Error(`unvibe network guard: blocked non-loopback connect to ${host}`);
    // Fail like a refused socket: emit error async, don't connect.
    const cb = args.find((a) => typeof a === "function") as ((e: Error) => void) | undefined;
    queueMicrotask(() => {
      try {
        (this as net.Socket).emit("error", err);
      } catch {
        // Ignore.
      }
      cb?.(err);
    });
    return this;
  }
  return (origConnect as (...a: unknown[]) => net.Socket).apply(this, args);
};

// --- tls.connect ----------------------------------------------------------
const origTlsConnect = tls.connect;
(tls as unknown as Record<string, unknown>).connect = function (...args: unknown[]): unknown {
  let host = "";
  const first = args[0] as unknown;
  if (typeof first === "object" && first !== null) {
    host = String((first as { host?: string }).host ?? (first as { servername?: string }).servername ?? "");
  } else if (typeof args[1] === "string") {
    host = args[1] as string;
  }
  if (host && !isLoopbackHost(host)) {
    record("tls.connect", host);
    throw new Error(`unvibe network guard: blocked non-loopback tls.connect to ${host}`);
  }
  return (origTlsConnect as (...a: unknown[]) => unknown).apply(tls, args);
};

// --- dns.lookup -----------------------------------------------------------
const origLookup = dns.lookup;
(dns as unknown as Record<string, unknown>).lookup = function (
  hostname: string,
  ...rest: unknown[]
): unknown {
  if (typeof hostname === "string" && !isLoopbackHost(hostname)) {
    record("dns.lookup", hostname);
    const cb = rest.find((a) => typeof a === "function") as
      | ((err: Error, address: string, family: number) => void)
      | undefined;
    const err = new Error(`unvibe network guard: blocked dns.lookup for ${hostname}`) as Error & { code: string };
    err.code = "ENOTFOUND";
    if (cb) {
      queueMicrotask(() => cb(err, "", 4));
      return undefined;
    }
    throw err;
  }
  return (origLookup as (...a: unknown[]) => unknown).apply(dns, [hostname, ...rest]);
};

// --- global fetch ---------------------------------------------------------
const origFetch = globalThis.fetch;
if (typeof origFetch === "function") {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const host = hostOfUrl(url);
    if (host && !isLoopbackHost(host)) {
      record("fetch", host);
      throw new Error(`unvibe network guard: blocked non-loopback fetch to ${host}`);
    }
    return origFetch(input, init);
  }) as typeof fetch;
}
