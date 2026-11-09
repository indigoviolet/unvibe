/**
 * Traces survive a data reset (issue #356): the store lives in
 * `<dataDir>-traces`, next to the data dir, so moving the data dir aside
 * (reset-data) leaves the traces untouched, and a fresh service on the
 * same data dir keeps recording into the same file. Export keeps working
 * across the reset.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TraceRecorder } from "../src/traces/recorder.js";
import { setActiveTracer } from "../src/traces/index.js";
import { spansFile, tracesDir } from "../src/traces/paths.js";

describe("traces survive a data reset (#356)", () => {
  it("a moved-aside data dir leaves the sibling store readable and exportable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-traces-reset-"));
    const dataDir = path.join(root, "unvibe-data");
    fs.mkdirSync(dataDir, { recursive: true });
    try {
      const before = new TraceRecorder(dataDir);
      expect(tracesDir(dataDir)).toBe(`${dataDir}-traces`);
      setActiveTracer(before);
      before.setEnabled(true);
      before.startSpan("job reader", { "job.kind": "reader" }).end();
      before.startSpan("sqlite select", { "sqlite.table": "reviews" }).end();
      expect(before.status().spans).toBe(2);
      expect(fs.existsSync(spansFile(dataDir))).toBe(true);

      // reset-data semantics: move the data dir aside, recreate it empty.
      // The sibling traces dir is not touched.
      const movedAside = `${dataDir}.bak-test`;
      fs.renameSync(dataDir, movedAside);
      fs.mkdirSync(dataDir, { recursive: true });
      expect(fs.existsSync(spansFile(dataDir))).toBe(true);

      // A fresh service generation on the same data dir sees the old
      // spans and keeps recording into the same file.
      const after = new TraceRecorder(dataDir);
      setActiveTracer(after);
      expect(after.status().spans).toBe(2);
      after.setEnabled(true);
      after.startSpan("job critic", { "job.kind": "critic" }).end();
      expect(after.status().spans).toBe(3);
      const exported = JSON.stringify(after.exportOtlp());
      expect(exported).toContain("job reader");
      expect(exported).toContain("job critic");
      expect(exported).toContain("sqlite select");
    } finally {
      setActiveTracer(null);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
