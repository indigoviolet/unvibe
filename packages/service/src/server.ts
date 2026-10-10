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
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { hasValidToken } from "./auth.js";
import { EventBus } from "./events.js";
import { registerRoutes } from "./routes/index.js";
import type { ServiceConfig } from "./config.js";

export const SERVICE_VERSION = "0.0.1";

export interface AppContext {
  app: FastifyInstance;
  bus: EventBus;
}

function webDistDir(): string {
  // packages/service/dist/*.js → packages/web/dist
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "web", "dist");
}

export async function createApp(token: string): Promise<AppContext> {
  const app = Fastify({ logger: false });
  const bus = new EventBus();

  await app.register(websocket);

  // Global auth gate.
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url;
    if (url === "/api/health" || url.startsWith("/api/health?")) return;
    // Static build assets carry no review data; the shell + API + WS are gated.
    if (url.startsWith("/assets/")) return;
    if (!hasValidToken({ headers: req.headers, query: req.query as Record<string, string> }, token)) {
      reply.code(401).send({ error: "missing or invalid token" });
    }
  });

  app.get("/api/health", async () => ({ ok: true, version: SERVICE_VERSION }));

  await registerRoutes(app, bus);

  // Static web app with SPA fallback. The Vite build emits dist/index.html
  // plus dist/assets/* (hashed, no review data — served without a token so
  // the shell can load after the first authenticated navigation).
  const dist = webDistDir();
  await app.register(fastifyStatic, { root: dist });
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

  return { app, bus };
}

export async function listen(app: FastifyInstance, config: ServiceConfig): Promise<string> {
  await app.listen({ host: config.host, port: config.port });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : config.port;
  return `http://${config.host}:${port}`;
}
