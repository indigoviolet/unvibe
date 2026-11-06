/**
 * Opt-in performance traces (#356): off means no spans (no exporter, no
 * file), on records every category, Clear/size/status work, the export is
 * OTLP JSON, and a canary seeded through every span kind — review ids,
 * commands, paths, models, browser paths — appears nowhere.
 */
import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JobQueue } from "../src/jobs/queue.js";
import { RealCommandRunner } from "../src/exec/runner.js";
import { openDatabase } from "../src/store/db.js";
import { SettingsStore } from "../src/settings/store.js";
import { createApp } from "../src/server.js";
import {
  TRACE_SAFETY_CAP_BYTES,
  TraceRecorder,
  setActiveRecorder,
  traceSpan,
} from "../src/traces/index.js";

afterEach(() => {
  setActiveRecorder(null);
});

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-traces-"));
}

function spanNames(rec: TraceRecorder): string[] {
  const scopes = rec.exportOtlp().resourceSpans[0]!.scopeSpans;
  return scopes.flatMap((s) => s.spans.map((sp) => sp.name));
}

function exportText(rec: TraceRecorder): string {
  return JSON.stringify(rec.exportOtlp());
}

describe("traces (#356)", () => {
  it("off by default: spans are no-ops, no exporter, no file", () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      expect(rec.enabled).toBe(false);
      expect(rec.status()).toEqual({ recording: false, spans: 0, bytes: 0, capped: false });
      const span = rec.startSpan("http GET /api/reviews", { "http.method": "GET" });
      span.setAttribute("http.route", "/api/reviews");
      span.end({ "http.status_code": 200 });
      expect(fs.existsSync(path.join(dir, "traces", "spans.jsonl"))).toBe(false);
      expect(rec.status().spans).toBe(0);
      expect(rec.exportOtlp().resourceSpans[0]!.scopeSpans[0]!.spans).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records one span per category with scrubbed attributes", () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      rec.setEnabled(true);
      rec.startSpan("http GET /api/reviews", { "http.method": "GET", "http.route": "/api/reviews" }).end({ "http.status_code": 200 });
      rec.startSpan("job reader", { "job.kind": "reader", "job.review": "rv-abc123" }).end({ "job.state": "done" });
      rec.startSpan("exec git", { "exec.cmd": "git" }).end({ "exec.code": 0 });
      rec.startSpan("sqlite select", { "sqlite.table": "reviews" }).end();
      rec.startSpan("ingest", { review: "rv-abc123" }).end();
      rec.startSpan("refresh", { review: "rv-abc123" }).end();
      rec.startSpan("open-to-first-card", { review: "rv-abc123" }).end();
      const names = spanNames(rec);
      expect(names).toEqual([
        "http GET /api/reviews",
        "job reader",
        "exec git",
        "sqlite select",
        "ingest",
        "refresh",
        "open-to-first-card",
      ]);
      const status = rec.status();
      expect(status.recording).toBe(true);
      expect(status.spans).toBe(7);
      expect(status.bytes).toBeGreaterThan(0);
      // Review ids hash (never verbatim); enums stay readable.
      const text = exportText(rec);
      expect(text).not.toContain("rv-abc123");
      expect(text).toContain("job reader");
      // OTLP shape: resource + scope + hex ids + nano times.
      const out = rec.exportOtlp();
      expect(out.resourceSpans[0]!.resource!.attributes).toEqual([
        { key: "service.name", value: { stringValue: "unvibe" } },
      ]);
      for (const span of out.resourceSpans[0]!.scopeSpans[0]!.spans) {
        expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(Number(span.startTimeUnixNano)).toBeGreaterThan(0);
        expect(Number(span.endTimeUnixNano)).toBeGreaterThanOrEqual(Number(span.startTimeUnixNano));
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stopping ends recording; Clear empties the store and lifts the cap", () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      rec.setEnabled(true);
      rec.startSpan("ingest", { review: "rv-1" }).end();
      expect(rec.status().spans).toBe(1);
      rec.setEnabled(false);
      rec.startSpan("ingest", { review: "rv-2" }).end();
      expect(rec.status().spans).toBe(1);
      expect(rec.status().recording).toBe(false);
      rec.clear();
      expect(rec.status()).toEqual({ recording: false, spans: 0, bytes: 0, capped: false });
      // Recording resumes after a clear.
      rec.setEnabled(true);
      rec.startSpan("refresh", { review: "rv-3" }).end();
      expect(rec.status().spans).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to start past the safety cap instead of deleting data", () => {
    const dir = tempDir();
    try {
      fs.mkdirSync(path.join(dir, "traces"), { recursive: true });
      const file = path.join(dir, "traces", "spans.jsonl");
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

  it("canary leak test: nothing raw reaches the export, via any seam", async () => {
    const dir = tempDir();
    const CANARIES = [
      "CANARYTRACEJOBX",
      "CANARYTRACEPATH",
      "CANARYTRACECMDX",
      "CANARY MODEL/with spaces",
      "CANARYTRACEURLX",
      "987654",
      "0123456789abcdef0123456789abcdef01234567",
    ];
    try {
      const rec = new TraceRecorder(dir);
      setActiveRecorder(rec);
      rec.setEnabled(true);
      // Every span kind, seeded with canaries in ids, names, paths, models.
      rec.startSpan("http GET /api/reviews", {
        "http.method": "GET",
        "http.route": "/api/reviews",
        "job.review": "rv-CANARYTRACEJOBX",
      }).end();
      traceSpan("job ask", {
        "job.kind": "ask",
        "job.provider": "claude",
        // Hostile-shaped model (spaces + slash): hashed, never verbatim.
        "job.model": "CANARY MODEL/with spaces",
        "job.review": "rv-CANARYTRACEJOBX",
      }).end({ "job.state": "done" });
      traceSpan("sqlite select", { "sqlite.table": "reviews" }).end();
      traceSpan("ingest", { review: "rv-CANARYTRACEJOBX" }).end();
      // Real exec seam with a hostile command: the basename is not a
      // safe token, so the span is `exec other` and the raw name hashes.
      await expect(
        new RealCommandRunner().run("CANARY CMD", { args: ["--CANARYTRACEURLX", "canary/CANARYTRACEPATH"] }),
      ).rejects.toThrow();
      // Browser ingest: raw paths (hashed server-side), a hostile method
      // (dropped: not an allowlisted verb), and rejected junk.
      const ingested = rec.ingestBrowser({
        spans: [
          { kind: "document-load", path: "/review/rv-CANARYTRACEJOBX?token=CANARYTRACEURLX", startMs: Date.now() - 50, durationMs: 50, traceId: "a".repeat(32), spanId: "b".repeat(16) },
          { kind: "fetch", method: "CANARYTRACECMDX", status: 200, path: "/api/CANARYTRACEPATH", startMs: Date.now() - 10, durationMs: 5, traceId: "c".repeat(32), spanId: "d".repeat(16) },
          { kind: "'; DROP TABLE--", path: "x", startMs: 1, durationMs: 1, traceId: "e".repeat(32), spanId: "f".repeat(16) },
          { kind: "fetch", startMs: NaN, durationMs: 5, traceId: "e".repeat(32), spanId: "f".repeat(16) },
        ],
      });
      expect(ingested).toEqual({ accepted: 2, rejected: 2 });
      // Real sqlite seam: SQL text and bound values never reach spans.
      const db = openDatabase(":memory:");
      db.prepare("SELECT ? AS x -- canary/CANARYTRACEPATH").get("CANARYTRACEJOBX");
      db.close();
      const text = exportText(rec);
      for (const canary of CANARIES) {
        expect(text, `canary leaked: ${canary}`).not.toContain(canary);
        for (let i = 0; i + 6 <= canary.length; i++) {
          expect(text, `canary substring leaked: ${canary.slice(i, i + 6)}`).not.toContain(canary.slice(i, i + 6));
        }
      }
      expect(text).not.toMatch(/\b[0-9a-f]{40}\b/i);
      // Browser spans kept their trace linkage with hashed paths.
      const spans = rec.exportOtlp().resourceSpans[0]!.scopeSpans[0]!.spans;
      const browser = spans.filter((s) => s.name.startsWith("browser "));
      expect(browser).toHaveLength(2);
      expect(browser[0]!.traceId).toBe("a".repeat(32));
      expect(spanNames(rec)).toContain("job ask");
      expect(spanNames(rec)).toContain("sqlite select");
    } finally {
      setActiveRecorder(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("queue, exec and sqlite seams record while on and stay silent while off", async () => {
    const dir = tempDir();
    try {
      const rec = new TraceRecorder(dir);
      setActiveRecorder(rec);
      // Off: seams run, nothing stored.
      const quiet = new JobQueue();
      quiet.enqueue({
        reviewId: "rv-quiet", kind: "reader", provider: "claude", model: "m", effort: "", priority: 1,
        run: () => Promise.resolve(),
      });
      await quiet.drain();
      expect(rec.status().spans).toBe(0);
      // On: one span per attempt, per process, per statement.
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
      const names = spanNames(rec);
      expect(names).toContain("job critic");
      expect(names.some((n) => n.startsWith("exec "))).toBe(true);
      expect(names).toContain("sqlite select");
      const jobSpan = rec.exportOtlp().resourceSpans[0]!.scopeSpans[0]!.spans.find((s) => s.name === "job critic")!;
      const attrs = Object.fromEntries((jobSpan.attributes ?? []).map((a) => [a.key, a.value]));
      expect(attrs["job.kind"]).toEqual({ stringValue: "critic" });
      expect(attrs["job.attempt"]).toEqual({ intValue: "1" });
      expect(JSON.stringify(attrs)).not.toContain("rv-seam");
    } finally {
      setActiveRecorder(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("service routes: switch toggles recording, export downloads OTLP, clear empties", async () => {
    const dir = tempDir();
    const db = openDatabase(":memory:");
    const settings = new SettingsStore(db);
    const { app } = await createApp("tok-traces-test", { db, dataDir: dir, settings });
    try {
      const auth = { authorization: "Bearer tok-traces-test" };
      const off = await app.inject({ method: "GET", url: "/api/traces/status", headers: auth });
      expect(off.statusCode).toBe(200);
      expect(off.json()).toMatchObject({ recording: false, spans: 0 });
      // Unknown build: no traces wired stays 501-proof — here wired, so 200.
      const put = await app.inject({
        method: "PUT", url: "/api/settings", headers: auth, payload: { recordTraces: true },
      });
      expect(put.statusCode).toBe(200);
      const on = await app.inject({ method: "GET", url: "/api/traces/status", headers: auth });
      expect(on.json()).toMatchObject({ recording: true });
      // The HTTP seam recorded the requests above.
      const exported = await app.inject({ method: "GET", url: "/api/traces/export", headers: auth });
      expect(exported.statusCode).toBe(200);
      expect(exported.headers["content-disposition"]).toContain("unvibe-traces.json");
      const body = exported.json() as { resourceSpans: { scopeSpans: { spans: { name: string }[] }[] }[] };
      const names = body.resourceSpans[0]!.scopeSpans.flatMap((s) => s.spans.map((sp) => sp.name));
      expect(names.some((n) => n.startsWith("http GET /api/traces/status"))).toBe(true);
      const cleared = await app.inject({ method: "POST", url: "/api/traces/clear", headers: auth });
      expect(cleared.json()).toMatchObject({ spans: 0, bytes: 0 });
      // Browser beacon round-trips through the same store.
      const beacon = await app.inject({
        method: "POST", url: "/api/traces/spans", headers: auth,
        payload: { spans: [{ kind: "fetch", path: "/settings", startMs: Date.now() - 5, durationMs: 5, traceId: "1".repeat(32), spanId: "2".repeat(16) }] },
      });
      expect(beacon.json()).toEqual({ accepted: 1, rejected: 0 });
    } finally {
      await app.close();
      db.close();
      setActiveRecorder(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
