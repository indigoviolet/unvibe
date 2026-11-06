/**
 * Opt-in performance traces (#356, owner decisions 2026-11-06): latest
 * OTel with auto-instrumentation (HTTP, Fastify, undici, fs) plus manual
 * spans only for jobs, SQLite, milestones and child processes. The local
 * recording is RAW — whatever the instrumentations capture. Scrubbing
 * happens in a processor ON EXPORT, and the canary leak test runs
 * against the exported file.
 */
// Prelude first (as in production): hooks install before fastify loads.
import { ensureTracingSetup } from "../src/traces/loader.js";
await ensureTracingSetup();
import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { JobQueue } from "../src/jobs/queue.js";
import { RealCommandRunner } from "../src/exec/runner.js";
import { openDatabase } from "../src/store/db.js";
import { SettingsStore } from "../src/settings/store.js";
import { createApp } from "../src/server.js";
import {
  TRACE_SAFETY_CAP_BYTES,
  setActiveTracer,
  traceSpan,
} from "../src/traces/index.js";
import { TraceRecorder } from "../src/traces/recorder.js";
import { spansFile } from "../src/traces/paths.js";

afterEach(() => {
  setActiveTracer(null);
});

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-traces-"));
}

function readStore(dir: string): string {
  return fs.readFileSync(spansFile(dir), "utf8");
}

function exportedNames(dir: string, rec: TraceRecorder): string[] {
  const scopes = rec.exportOtlp().resourceSpans[0]!.scopeSpans;
  return scopes.flatMap((s) => s.spans.map((sp) => sp.name));
}

describe("traces (#356)", () => {
  it("off by default: spans are no-ops, no exporter, no file", () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      expect(rec.enabled).toBe(false);
      expect(rec.status()).toEqual({ recording: false, spans: 0, bytes: 0, capped: false });
      rec.startSpan("job reader", { "job.kind": "reader" }).end();
      expect(fs.existsSync(spansFile(dir))).toBe(false);
      expect(rec.status().spans).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records manual spans raw, with OTLP spec kinds on export", () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      rec.setEnabled(true);
      rec.startSpan("job reader", { "job.kind": "reader", "job.review": "rv-raw-1" }).end({ "job.state": "done" });
      rec.startSpan("sqlite select", { "sqlite.table": "reviews" }).end();
      rec.startSpan("exec git", { "exec.cmd": "git", "exec.argv": "log --oneline" }).end({ "exec.code": 0 });
      rec.startSpan("ingest", { review: "rv-raw-1" }).end();
      // Raw recording keeps review ids verbatim; the export hashes them.
      expect(readStore(dir)).toContain("rv-raw-1");
      const out = rec.exportOtlp();
      expect(out.resourceSpans[0]!.resource!.attributes).toEqual([
        { key: "service.name", value: { stringValue: "unvibe" } },
      ]);
      for (const span of out.resourceSpans[0]!.scopeSpans[0]!.spans) {
        expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
        // Spec kinds: internal 1, server 2, client 3 (API 0/1/2 mapped).
        expect([1, 2, 3, 4, 5]).toContain(span.kind);
      }
      const text = JSON.stringify(out);
      expect(text).not.toContain("rv-raw-1");
      expect(text).not.toContain("log --oneline");
      expect(exportedNames(dir, rec)).toContain("job reader");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("auto HTTP spans record raw URLs and export scrubbed routes", async () => {
    const dir = tempDir();
    const db = openDatabase(":memory:");
    const { app, ctx } = await createApp("tok-traces-auto", { db, dataDir: dir });
    try {
      // Enable through the app's own recorder: real socket traffic below.
      ctx.traces?.setEnabled(true);
      const port = 48741;
      await app.listen({ port, host: "127.0.0.1" });
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health?token=tok-traces-auto`);
        await res.text();
      } finally {
        await app.close();
      }
      const raw = readStore(dir);
      expect(raw).toContain("tok-traces-auto");
      const rec = ctx.traces!;
      const text = JSON.stringify(rec.exportOtlp());
      expect(text).not.toContain("tok-traces-auto");
      expect(text).not.toContain("?token=");
      expect(text).not.toContain("user_agent");
      expect(text).not.toContain("http.status_text");
      // Client span survives, scrubbed; server spans need the real
      // bundle (vitest ESM misses the fastify/http patch — covered by
      // the CJS test below and the post-gate journey).
      expect(exportedNames(dir, rec)).toContain("fetch GET");
    } finally {
      db.close();
      setActiveTracer(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fastify instrumentation is registered (CJS require path)", async () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      setActiveTracer(rec);
      rec.setEnabled(true);
      const require = createRequire(import.meta.url);
      const fastify = require("fastify")();
      fastify.get("/ping", async () => ({ ok: true }));
      await fastify.listen({ port: 48742, host: "127.0.0.1" });
      try {
        await fetch("http://127.0.0.1:48742/ping");
      } finally {
        await fastify.close();
      }
      const spans = rec.exportOtlp().resourceSpans[0]!.scopeSpans[0]!.spans;
      const names = spans.map((s) => s.name);
      // Fastify handler keeps its operation name with the route pattern;
      // the raw `GET /ping` server span becomes `http GET /ping`.
      expect(names).toContain("request handler - fastify");
      expect(names).toContain("http GET /ping");
      const server = spans.find((s) => s.name === "http GET /ping")!;
      // Ports stay (numbers); hosts/URLs hash; no query, no user agent.
      expect(JSON.stringify(server)).not.toMatch(/127\.0\.0\.1|user_agent|status_text/);
    } finally {
      setActiveTracer(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stopping ends recording; Clear empties the store", () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      rec.setEnabled(true);
      rec.startSpan("ingest", { review: "rv-1" }).end();
      expect(rec.status().spans).toBeGreaterThan(0);
      rec.setEnabled(false);
      const before = rec.status().spans;
      rec.startSpan("ingest", { review: "rv-2" }).end();
      expect(rec.status().spans).toBe(before);
      expect(rec.status().recording).toBe(false);
      rec.clear();
      expect(rec.status().spans).toBe(0);
      expect(fs.existsSync(spansFile(dir))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to start past the safety cap instead of deleting data", () => {
    const dir = tempDir();
    try {
      fs.mkdirSync(path.join(dir, "traces"), { recursive: true });
      const file = spansFile(dir);
      fs.writeFileSync(file, "{}\n");
      fs.truncateSync(file, TRACE_SAFETY_CAP_BYTES + 1); // sparse: no 256 MB write
      const rec = new TraceRecorder(dir);
      rec.setEnabled(true);
      expect(rec.enabled).toBe(false);
      expect(rec.status().capped).toBe(true);
      expect(rec.status().bytes).toBeGreaterThanOrEqual(TRACE_SAFETY_CAP_BYTES);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("canary leak test: raw capture is real, the EXPORT is clean", async () => {
    const dir = tempDir();
    const CANARIES = [
      "CANARYTRACEJOBX",
      "CANARYTRACEPATH",
      "CANARY MODEL/with spaces",
      "CANARYTRACEURLX",
      "987654",
      "0123456789abcdef0123456789abcdef01234567",
    ];
    try {
      const rec = new TraceRecorder(dir);
      setActiveTracer(rec);
      rec.setEnabled(true);
      // Manual seams with canaries in ids, names, argv, SQL text.
      traceSpan("job ask", {
        "job.kind": "ask",
        "job.model": "CANARY MODEL/with spaces",
        "job.review": "rv-CANARYTRACEJOBX",
      }).end({ "job.state": "done" });
      traceSpan("ingest", { review: "rv-CANARYTRACEJOBX" }).end();
      await expect(
        new RealCommandRunner().run("CANARY CMD", { args: ["--CANARYTRACEURLX", "canary/CANARYTRACEPATH"] }),
      ).rejects.toThrow();
      // Table names are fixed schema (never review content): the canary
      // rides in the SQL comment and the bound value, neither of which
      // may reach a span.
      const db = openDatabase(":memory:");
      db.exec("CREATE TABLE scratch_t (id INTEGER)");
      db.prepare("SELECT * FROM scratch_t WHERE id = ? -- canary/CANARYTRACEPATH").get("CANARYTRACEJOBX");
      db.close();
      // Browser ingest, raw: hostile path, hostile method, junk rejected.
      const ingested = rec.ingestBrowser({
        spans: [
          { kind: "document-load", name: "document-load", startMs: Date.now() - 50, durationMs: 50, traceId: "a".repeat(32), spanId: "b".repeat(16), attributes: { "browser.path": "/review/rv-CANARYTRACEJOBX?token=CANARYTRACEURLX" } },
          { kind: "fetch", name: "fetch", startMs: Date.now() - 10, durationMs: 5, traceId: "c".repeat(32), spanId: "d".repeat(16), attributes: { "http.request.method": "CANARYTRACECMDX", "url.full": "http://x/api/CANARYTRACEPATH?token=CANARYTRACEURLX" } },
          { kind: "'; DROP TABLE--", traceId: "e".repeat(32), spanId: "f".repeat(16) },
          { kind: "fetch", name: "fetch", startMs: NaN, durationMs: 5, traceId: "e".repeat(32), spanId: "f".repeat(16) },
        ],
      });
      // Raw kinds are accepted (scrubbed on export); only malformed
      // entries reject.
      expect(ingested).toEqual({ accepted: 3, rejected: 1 });
      // The raw recording really captured the review id (test not vacuous).
      expect(readStore(dir)).toContain("CANARYTRACEJOBX");
      // The export: no canary, no 6+ substring, no SHAs, no raw messages.
      const text = JSON.stringify(rec.exportOtlp());
      for (const canary of CANARIES) {
        expect(text, `canary leaked: ${canary}`).not.toContain(canary);
        for (let i = 0; i + 6 <= canary.length; i++) {
          expect(text, `canary substring leaked: ${canary.slice(i, i + 6)}`).not.toContain(canary.slice(i, i + 6));
        }
      }
      expect(text).not.toMatch(/\b[0-9a-f]{40}\b/i);
      expect(text).not.toMatch(/\?token=/);
      expect(text).not.toMatch(/CANARYTRACEURLX/);
      // Spot-check the scrubbed shapes survive (hostile browser kind
      // collapses to the fixed label).
      expect(text).toContain("job ask");
      expect(text).toContain("exec other");
      expect(text).toContain("sqlite select");
      expect(text).toContain("document-load");
      expect(text).not.toContain("DROP TABLE");
    } finally {
      setActiveTracer(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("queue, exec and sqlite seams record raw while on, silent while off", async () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      setActiveTracer(rec);
      const quiet = new JobQueue();
      quiet.enqueue({
        reviewId: "rv-quiet", kind: "reader", provider: "claude", model: "m", effort: "", priority: 1,
        run: () => Promise.resolve(),
      });
      await quiet.drain();
      expect(rec.status().spans).toBe(0);
      rec.setEnabled(true);
      const queue = new JobQueue();
      queue.enqueue({
        reviewId: "rv-seam", kind: "critic", provider: "pi", model: "muse-spark", effort: "", priority: 1,
        run: () => Promise.resolve(),
      });
      await queue.drain();
      await new RealCommandRunner().run(process.execPath, { args: ["--version"] });
      const db = openDatabase(":memory:");
      db.prepare("SELECT 1 AS one").get();
      db.close();
      const raw = readStore(dir);
      expect(raw).toContain("rv-seam");
      const names = exportedNames(dir, rec);
      expect(names).toContain("job critic");
      expect(names.some((n) => n.startsWith("exec "))).toBe(true);
      expect(names).toContain("sqlite select");
      expect(JSON.stringify(rec.exportOtlp())).not.toContain("rv-seam");
    } finally {
      setActiveTracer(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("service routes: switch toggles recording, export downloads scrubbed OTLP, clear empties", async () => {
    const dir = tempDir();
    const db = openDatabase(":memory:");
    const settings = new SettingsStore(db);
    const { app } = await createApp("tok-traces-test", { db, dataDir: dir, settings });
    try {
      const auth = { authorization: "Bearer tok-traces-test" };
      const off = await app.inject({ method: "GET", url: "/api/traces/status", headers: auth });
      expect(off.statusCode).toBe(200);
      expect(off.json()).toMatchObject({ recording: false, spans: 0 });
      const put = await app.inject({
        method: "PUT", url: "/api/settings", headers: auth, payload: { recordTraces: true },
      });
      expect(put.statusCode).toBe(200);
      // app.inject bypasses the HTTP server (no auto spans): a second
      // write proves the queue DB writes land while recording is on.
      await app.inject({
        method: "PUT", url: "/api/settings", headers: auth, payload: { recordTraces: true },
      });
      const on = await app.inject({ method: "GET", url: "/api/traces/status", headers: auth });
      expect(on.json()).toMatchObject({ recording: true });
      expect(on.json().spans).toBeGreaterThan(0);
      const exported = await app.inject({ method: "GET", url: "/api/traces/export", headers: auth });
      expect(exported.statusCode).toBe(200);
      expect(exported.headers["content-disposition"]).toContain("unvibe-traces.json");
      const body = exported.json() as { resourceSpans: { scopeSpans: { spans: { name: string }[] }[] }[] };
      const names = body.resourceSpans[0]!.scopeSpans.flatMap((s) => s.spans.map((sp) => sp.name));
      // app.inject bypasses the HTTP server (no auto HTTP spans here —
      // covered by the real-socket tests above); the settings writes do.
      expect(names).toContain("sqlite select");
      expect(JSON.stringify(body)).not.toContain("tok-traces-test");
      const cleared = await app.inject({ method: "POST", url: "/api/traces/clear", headers: auth });
      // The switch is still on, so clearing resumes recording. (The
      // clear request's own fastify spans end after the wipe, so the
      // store is not exactly empty — but the beacon span is gone.)
      expect(cleared.json()).toMatchObject({ recording: true });
      const wiped = JSON.stringify(await app.inject({ method: "GET", url: "/api/traces/export", headers: auth }).then((r) => r.json()));
      expect(wiped).not.toContain("1".repeat(32));
      const beacon = await app.inject({
        method: "POST", url: "/api/traces/spans", headers: auth,
        payload: { spans: [{ kind: "fetch", name: "fetch", startMs: Date.now() - 5, durationMs: 5, traceId: "1".repeat(32), spanId: "2".repeat(16), attributes: { "url.full": "http://127.0.0.1/settings?token=tok-traces-test" } }] },
      });
      expect(beacon.json()).toEqual({ accepted: 1, rejected: 0 });
      const after = await app.inject({ method: "GET", url: "/api/traces/export", headers: auth });
      expect(JSON.stringify(after.json())).not.toContain("tok-traces-test");
    } finally {
      await app.close();
      db.close();
      setActiveTracer(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
