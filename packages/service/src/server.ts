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
import type { CommandRunner } from "./exec/index.js";
import { MCP_ROUTE_PREFIX } from "./mcp/index.js";
import type { McpRegistry } from "./mcp/index.js";
import type { JobQueue } from "./jobs/index.js";
import type { ModelCatalog } from "./settings/index.js";
import type { SettingsStore } from "./settings/index.js";
import { registerRoutes, type ReviewsRouteDeps, type RouteDeps } from "./routes/index.js";
import { buildApp, type AppContext as UnifiedContext } from "./app.js";
import type { ServiceConfig } from "./config.js";
import { migrate, openDatabase, type DatabaseSync } from "./store/index.js";

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
  /** Agent runner (replay/fake/ACP seam). Defaults via factory (UNVIBE_AGENT). */
  agents?: AgentRunner;
  promptsDir?: string;
  fixturesDir?: string;
  mcpBaseUrl?: string;
  models?: ModelCatalog;
  /** Test override for the MCP registry (mcp.test). */
  mcp?: McpRegistry;
  jobs?: JobQueue;
  settings?: SettingsStore;
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

  // Global auth gate.
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url;
    if (url === "/api/health" || url.startsWith("/api/health?")) return;
    // Static build assets carry no review data; the shell + API + WS are gated.
    if (url.startsWith("/assets/")) return;
    // MCP sessions carry their own 256-bit secret in the URL (agent
    // subprocesses present the secret, not the install token).
    if (url.startsWith(MCP_ROUTE_PREFIX)) return;
    if (!hasValidToken({ headers: req.headers, query: req.query as Record<string, string> }, token)) {
      reply.code(401).send({ error: "missing or invalid token" });
    }
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

  return { app, bus, ctx, deps: routeDeps };
}

export async function listen(app: FastifyInstance, config: ServiceConfig): Promise<string> {
  await app.listen({ host: config.host, port: config.port });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : config.port;
  return `http://${config.host}:${port}`;
}
