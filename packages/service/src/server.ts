/**
 * HTTP + WebSocket server (PRD §14): Fastify bound to 127.0.0.1 only.
 *
 * Auth: per-install token required on everything except `/api/health`
 * (and the bare static-asset paths, which carry no data — see below).
 * Accepted as `Authorization: Bearer`, `?token=`, or cookie.
 *
 * Scaffold decision on static files: the token gate applies to `/api/*`,
 * WS, and the served HTML shell. Fingerprinted build assets under
 * `/assets/*` are served without a token so the page can load after the
 * first authenticated navigation (the web app persists the token from the
 * URL into localStorage + cookie). Documented for later agents.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { AgentRunner } from "@unvibe/shared";
import { hasValidToken } from "./auth.js";
import { CONTENT_SECURITY_POLICY } from "./security/csp.js";
import { hostCheckAllows } from "./security/host.js";
import type { CommandRunner } from "./exec/index.js";
import { DEFAULT_IDLE_MS, IdleMonitor } from "./lifecycle/index.js";
import { MCP_ROUTE_PREFIX } from "./mcp/index.js";
import type { McpRegistry } from "./mcp/index.js";
import type { JobQueue } from "./jobs/index.js";
import type { ModelCatalog } from "./settings/index.js";
import type { SettingsStore } from "./settings/index.js";
import { registerRoutes, type ReviewsRouteDeps, type RouteDeps } from "./routes/index.js";
import { buildApp, type AppContext as UnifiedContext } from "./app.js";
import type { ServiceConfig } from "./config.js";
import { migrate, openDatabase, type DatabaseSync } from "./store/index.js";
import { reportError } from "./telemetry/sentry.js";

export const SERVICE_VERSION = "0.0.1";

/** `createApp` return: Fastify app + unified context (all singletons). */
export interface AppContext {
  app: FastifyInstance;
  bus: UnifiedContext["bus"];
  /** Unified context (ServiceContext + RouteDeps + pipeline). Tests use `ctx.reviews`, `ctx.jobs`, `ctx.pipeline`, ... */
  ctx: UnifiedContext;
  deps: UnifiedContext;
}

export interface CreateAppOptions extends RouteDeps, ReviewsRouteDeps {
  /** Defaults to an in-memory database (tests) — production passes its own. */
  db?: DatabaseSync;
  /** Defaults to a fresh temp dir — production passes the real data dir. */
  dataDir?: string;
  /** Defaults to the real runner — tests inject fakes. */
  runner?: CommandRunner;
  /** Agent runner (replay/fake/ACP). Defaults via factory (UNVIBE_AGENT, else ACP). */
  agents?: AgentRunner;
  promptsDir?: string;
  fixturesDir?: string;
  mcpBaseUrl?: string;
  models?: ModelCatalog;
  /** Test override for the MCP registry (mcp.test). */
  mcp?: McpRegistry;
  jobs?: JobQueue;
  settings?: SettingsStore;
  /**
   * Idle-exit wiring (PRD §14, owned by the shell milestone). `idleMs`
   * defaults to 10 minutes; non-positive disables. `hasJobs` should report
   * running/queued jobs; when omitted it defaults to the real job queue's
   * `activeCount` (M3: idle exit works with the real queue). `onIdleExit`
   * runs clean shutdown. Omitted in tests that don't care.
   */
  lifecycle?: {
    idleMs?: number | null;
    hasJobs?: () => boolean;
    onIdleExit?: () => void | Promise<void>;
  };
}

/**
 * Static files that carry no review data and are served without a token:
 * fingerprinted build assets plus the installable-app pieces (manifest,
 * service worker, icons, offline start page). The HTML shell, API and WS
 * stay gated. Query strings are ignored when matching.
 */
const PUBLIC_STATIC_EXACT = new Set([
  "/manifest.webmanifest",
  "/sw.js",
  "/start.html",
  "/start.js",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
  "/apple-touch-icon.png",
  "/favicon.ico",
]);

function urlPathname(url: string): string {
  const q = url.indexOf("?");
  return q < 0 ? url : url.slice(0, q);
}

/** Friendly HTML for a browser navigation that arrived without a token. */
export function missingTokenHtml(): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8" />',
    "<title>Unvibe — sign in</title></head><body>",
    "<h1>Unvibe needs its per-install token</h1>",
    "<p>This page was opened without a token. Get one by running:</p>",
    "<p><code>unvibe open</code></p>",
    "<p>That starts the service if needed and opens the app URL (the token lives in the URL once, then in the app's local storage).</p>",
    "</body></html>",
  ].join("\n");
}

function webDistDir(): string {
  // packages/service/dist/*.js → packages/web/dist
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "web", "dist");
}

export async function createApp(token: string, opts: CreateAppOptions = {}): Promise<AppContext> {
  const app = Fastify({ logger: false });

  const db = opts.db ?? openDatabase(":memory:");
  migrate(db);
  const dataDir = opts.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-data-"));

  // Unified composition root (M3): builds jobs/settings/sessions/mcp/
  // pipeline with recovery. Explicit overrides (tests) win over defaults
  // and are wired into the pipeline itself.
  const ctx: UnifiedContext = buildApp({
    db,
    dataDir,
    ...(opts.runner ? { runner: opts.runner } : {}),
    ...(opts.agents ? { agents: opts.agents } : {}),
    ...(opts.promptsDir ? { promptsDir: opts.promptsDir } : {}),
    ...(opts.fixturesDir ? { fixturesDir: opts.fixturesDir } : {}),
    ...(opts.mcpBaseUrl ? { mcpBaseUrl: opts.mcpBaseUrl } : {}),
    ...(opts.models ? { models: opts.models } : {}),
    ...(opts.jobs ? { jobs: opts.jobs } : {}),
    ...(opts.settings ? { settings: opts.settings } : {}),
    ...(opts.mcp ? { mcp: opts.mcp } : {}),
  });
  const bus = ctx.bus;

  await app.register(websocket);

  // Idle-exit activity tracking (PRD §14, shell milestone): open WebSocket
  // clients and recent HTTP requests both count as an open window. The bus
  // is wrapped here (rather than in the events route) to keep the change
  // local to this file; the wrap is transparent to subscribers.
  let wsClients = 0;
  let lastHttpAt: number | null = null;
  const subscribeRaw = bus.subscribe.bind(bus);
  bus.subscribe = (reviewId, send) => {
    wsClients += 1;
    const unsub = subscribeRaw(reviewId, send);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      wsClients -= 1;
      unsub();
    };
  };

  // Global auth gate.
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url;
    // DNS-rebinding / cross-site defense (defense in depth behind the
    // install token): only loopback Host and loopback Origin/Referer ever
    // reach a handler. Applies to every route including /api/health and
    // the MCP mount (WebSocket handshakes pass through here too).
    const allowed = hostCheckAllows({ headers: req.headers as Record<string, string | string[] | undefined> });
    if (!allowed.ok) {
      reply.code(403).send({ error: `forbidden: ${allowed.reason}` });
      return;
    }
    if (url === "/api/health" || url.startsWith("/api/health?")) return;
    const pathname = urlPathname(url);
    // Static build assets and installable-app files carry no review data;
    // the shell + API + WS are gated.
    if (pathname.startsWith("/assets/") || PUBLIC_STATIC_EXACT.has(pathname)) return;
    // MCP sessions carry their own 256-bit secret in the URL (agent
    // subprocesses present the secret, not the install token).
    if (url.startsWith(MCP_ROUTE_PREFIX)) return;
    if (!hasValidToken({ headers: req.headers, query: req.query as Record<string, string> }, token)) {
      // A browser navigation without a token gets human help (how to get
      // one: `unvibe open`); API/WS callers keep the JSON 401.
      const accept = String(req.headers["accept"] ?? "");
      if (req.method === "GET" && !url.startsWith("/api/") && accept.includes("text/html")) {
        reply.code(401).type("text/html").send(missingTokenHtml());
        return;
      }
      reply.code(401).send({ error: "missing or invalid token" });
    }
  });

  // Dev-only error reporting (issue #29): server faults, not 4xx replies.
  // A no-op unless Sentry is on.
  app.addHook("onError", async (req, _reply, err) => {
    if (err.statusCode !== undefined && err.statusCode < 500) return;
    reportError(err, { method: req.method, route: req.routeOptions.url });
  });

  // HTTP activity counts toward "open window", except health probes: the
  // `start` waiter (and any external prober) must not keep the service
  // alive. Kept as a separate hook so the auth gate above stays untouched.
  app.addHook("onRequest", async (req) => {
    const url = req.url;
    if (url === "/api/health" || url.startsWith("/api/health?")) return;
    lastHttpAt = Date.now();
  });

  // Strict CSP on every HTML shell response (PRD §16). API/WS stay JSON;
  // static assets are unaffected (the header is harmless on them, but we
  // scope to HTML to keep the policy tight and the tests precise).
  app.addHook("onSend", async (req, reply, payload) => {
    try {
      const ct = String(reply.getHeader("content-type") ?? "");
      const url = String(req.url ?? "");
      const pathname = urlPathname(url);
      const isHtml =
        ct.includes("text/html") ||
        pathname === "/" ||
        pathname === "/index.html" ||
        pathname === "/start.html" ||
        (!pathname.startsWith("/api/") && !pathname.startsWith("/assets/") && !pathname.includes("."));
      if (isHtml) reply.header("content-security-policy", CONTENT_SECURITY_POLICY);
    } catch {
      // Never break a response for a header.
    }
    return payload;
  });

  app.get("/api/health", async () => ({ ok: true, version: SERVICE_VERSION }));

  // Routes take (ctx, deps) where both are the unified context; explicit
  // test overrides (jobs, baseRunner, ...) win. The update pass defaults to
  // the pipeline's UpdateBaseRunner; M5 tests inject `baseRunner` directly.
  const routeDeps = {
    ...ctx,
    ...opts,
    ...(opts.baseRunner ? {} : { baseRunner: ctx.updateRunner }),
  };
  await registerRoutes(app, ctx, routeDeps);

  // Static web app with SPA fallback. The Vite build emits dist/index.html
  // plus dist/assets/* (hashed, no review data — served without a token so
  // the shell can load after the first authenticated navigation).
  const dist = webDistDir();
  if (fs.existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "unknown api route" });
    const indexFile = path.join(dist, "index.html");
    if (!fs.existsSync(indexFile)) {
      return reply
        .type("text/html")
        .send(
          "<!doctype html><title>Unvibe</title><p>Web build not found. Run <code>mise run build</code>.</p>",
        );
    }
    return reply.sendFile("index.html");
  });

  // Idle exit (PRD §14, shell milestone): exit after `idleMs` with no open
  // window (no WS clients, no recent HTTP) and no running/queued jobs.
  // The timer is unref'd so it never keeps the process alive by itself.
  // Default hasJobs uses the real job queue (M3), so `serve()` idle-exits
  // correctly without passing hasJobs explicitly.
  const idleMs = opts.lifecycle?.idleMs ?? DEFAULT_IDLE_MS;
  if (idleMs > 0) {
    const monitor = new IdleMonitor({
      state: {
        wsClients: () => wsClients,
        lastHttpAt: () => lastHttpAt,
        hasActiveJobs: opts.lifecycle?.hasJobs ?? (() => ctx.jobs.activeCount() > 0),
      },
      idleMs,
      onIdle: () => {
        void opts.lifecycle?.onIdleExit?.();
      },
    });
    monitor.start();
    app.addHook("onClose", async () => monitor.stop());
  }

  return { app, bus, ctx, deps: routeDeps };
}

export async function listen(app: FastifyInstance, config: ServiceConfig): Promise<string> {
  await app.listen({ host: config.host, port: config.port });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : config.port;
  return `http://${config.host}:${port}`;
}
