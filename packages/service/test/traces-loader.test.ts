/**
 * Tracing loader (issue #356, debug flavour): the guarded dynamic
 * import resolves to a working recorder when OTel is installed and to
 * null when it is missing — a lean install boots and runs with tracing
 * unavailable instead of crashing on the missing packages.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureTracingSetup, loadTraceRecorder, type RecorderImporter } from "../src/traces/loader.js";
import { getActiveTracer, setActiveTracer } from "../src/traces/index.js";

afterEach(() => {
  setActiveTracer(null);
});

const missingImporter: RecorderImporter = () => Promise.reject(new Error("Cannot find package '@opentelemetry/api'"));

const emptyImporter = (() =>
  Promise.resolve({
    ensureTracingSetup: vi.fn(),
    attachRouteHook: vi.fn(),
    TraceRecorder: undefined,
  })) as unknown as RecorderImporter;

describe("trace loader (#356)", () => {
  it("loads a working recorder when OTel is installed", async () => {
    expect(await ensureTracingSetup()).toBe(true);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-loader-"));
    try {
      const rec = await loadTraceRecorder(dir);
      expect(rec).not.toBeNull();
      expect(getActiveTracer()).not.toBeNull();
      rec!.setEnabled(true);
      expect(rec!.enabled).toBe(true);
      rec!.startSpan("loader probe", { "job.kind": "reader" }).end();
      expect(rec!.status().spans).toBe(1);
      rec!.setEnabled(false);
      rec!.clear();
    } finally {
      setActiveTracer(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("setup reports false when OTel is missing", async () => {
    await expect(ensureTracingSetup(missingImporter)).resolves.toBe(false);
  });

  it("recorder loading returns null when OTel is missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-loader-"));
    try {
      await expect(loadTraceRecorder(dir, missingImporter)).resolves.toBeNull();
      expect(getActiveTracer()).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("UNVIBE_DISABLE_TRACING=1 forces the lean path without touching OTel", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-loader-"));
    const old = process.env.UNVIBE_DISABLE_TRACING;
    process.env.UNVIBE_DISABLE_TRACING = "1";
    try {
      await expect(loadTraceRecorder(dir)).resolves.toBeNull();
      await expect(ensureTracingSetup()).resolves.toBe(false);
      expect(getActiveTracer()).toBeNull();
    } finally {
      if (old === undefined) delete process.env.UNVIBE_DISABLE_TRACING;
      else process.env.UNVIBE_DISABLE_TRACING = old;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recorder loading returns null when the module lacks the API", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-loader-"));
    try {
      await expect(loadTraceRecorder(dir, emptyImporter)).resolves.toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
