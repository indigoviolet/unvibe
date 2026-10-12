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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

declare global {
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

/**
 * Per-run temp root (issue #24).
 *
 * Every test file runs under this setup: a fresh directory is created in
 * the real system temp dir, `os.tmpdir()` is patched to return it (and
 * `TMPDIR`/`TEMP`/`TMP` point there for spawned children), and
 * `fs.mkdtemp*` calls under the real system temp dir are redirected into
 * it. At teardown the root is removed, so interrupted or failing tests
 * cannot leak `unvibe-*` directories — with no per-file edits.
 *
 * Guard (trap-safe): only exact paths this run created are judged. Other
 * worktrees' suites share the system temp dir; their `unvibe-test-*` roots
 * and entries are never touched. A bypass that creates a tracked path
 * outside the root and leaves it behind fails the file loudly.
 */
declare global {
  var __unvibeTmpReal: string | undefined;
  var __unvibeTmpRoots: string[] | undefined;
  var __unvibeTmpTracked: string[] | undefined;
  var __unvibeTmpPatched: boolean | undefined;
}

const realTmp: string =
  globalThis.__unvibeTmpReal ?? (globalThis.__unvibeTmpReal = (os.tmpdir as () => string).call(os));
if (!globalThis.__unvibeTmpRoots) globalThis.__unvibeTmpRoots = [];
if (!globalThis.__unvibeTmpTracked) globalThis.__unvibeTmpTracked = [];
const roots = globalThis.__unvibeTmpRoots;
const tracked = globalThis.__unvibeTmpTracked;

function redirectPrefix(prefix: string, root: string): string {
  // Already inside this run's root (the common case: path.join(os.tmpdir(),
  // ...) after the patch): leave it alone.
  if (root !== realTmp && (prefix === root || prefix.startsWith(root + path.sep))) return prefix;
  if (prefix === realTmp || prefix.startsWith(realTmp + path.sep)) {
    return path.join(root, prefix.slice(realTmp.length + (prefix === realTmp ? 0 : 1)));
  }
  return prefix;
}

function isUnder(p: string, root: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

if (!globalThis.__unvibeTmpPatched) {
  globalThis.__unvibeTmpPatched = true;
  const origTmpdir = os.tmpdir.bind(os);
  void origTmpdir;
  const origMkdtempSync = fs.mkdtempSync;
  const origMkdtemp = fs.mkdtemp;
  const origPromisesMkdtemp = fs.promises.mkdtemp;

  const currentRoot = (): string => roots[roots.length - 1] ?? realTmp;

  (os as unknown as { tmpdir: () => string }).tmpdir = () => currentRoot();

  (fs as unknown as { mkdtempSync: typeof fs.mkdtempSync }).mkdtempSync = ((prefix: string, ...rest: unknown[]) => {
    const out = (origMkdtempSync as (...a: unknown[]) => string)(redirectPrefix(prefix, currentRoot()), ...rest);
    tracked.push(out);
    return out;
  }) as typeof fs.mkdtempSync;

  (fs as unknown as { mkdtemp: typeof fs.mkdtemp }).mkdtemp = ((prefix: string, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === "function") as ((err: Error | null, dir?: string) => void) | undefined;
    const args = rest.filter((a) => typeof a !== "function");
    const wrappedCb = cb
      ? (err: Error | null, dir?: string) => {
          if (!err && dir) tracked.push(dir);
          cb(err, dir);
        }
      : undefined;
    return (origMkdtemp as (...a: unknown[]) => unknown)(
      redirectPrefix(prefix, currentRoot()),
      ...args,
      ...(wrappedCb ? [wrappedCb] : []),
    );
  }) as typeof fs.mkdtemp;

  fs.promises.mkdtemp = (async (prefix: string, ...rest: unknown[]) => {
    const out = await (origPromisesMkdtemp as (...a: unknown[]) => Promise<string>)(
      redirectPrefix(prefix, currentRoot()),
      ...rest,
    );
    tracked.push(out);
    return out;
  }) as typeof fs.promises.mkdtemp;

  // Interruption safety net: remove only our own roots by exact path.
  process.once("exit", () => {
    for (const r of [...roots]) {
      try {
        fs.rmSync(r, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  });
}

// One root per test file (setup runs before each file). `afterAll` below
// belongs to that file, so its root is removed when the file finishes —
// including when tests fail.
const fileRoot: string = (fs.mkdtempSync as (...a: unknown[]) => string)(
  path.join(realTmp, "unvibe-test-"),
) as string;
// The root itself is created before the patch records it; track explicitly.
tracked.push(fileRoot);
roots.push(fileRoot);
process.env.TMPDIR = fileRoot;
process.env.TEMP = fileRoot;
process.env.TMP = fileRoot;

afterAll(() => {
  const stillOutside: string[] = [];
  for (const p of tracked) {
    if (isUnder(p, fileRoot)) continue;
    // Other files' roots in this worker are theirs to clean; only judge
    // paths outside every known root of this process.
    if (roots.some((r) => r !== fileRoot && isUnder(p, r))) continue;
    try {
      if (fs.existsSync(p)) stillOutside.push(p);
    } catch {
      // ignore
    }
  }
  try {
    fs.rmSync(fileRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
  const idx = roots.indexOf(fileRoot);
  if (idx >= 0) roots.splice(idx, 1);
  if (stillOutside.length > 0) {
    throw new Error(
      `unvibe temp guard (#24): ${stillOutside.length} tracked temp path(s) left outside the per-run root:\n` +
        stillOutside.slice(0, 10).join("\n"),
    );
  }
});
