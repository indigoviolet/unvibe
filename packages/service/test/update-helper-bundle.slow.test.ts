/**
 * Switch-helper bundle containment (issue #36).
 *
 * `npm install -g` replaces the package directory the helper was loaded
 * from, so `dist/update-helper.js` must be self-contained: only the pure
 * `update/` modules plus leaf runtime imports, with every external import
 * a node builtin. This test scans the esbuild metafile
 * (`dist/update-helper-meta.json`, written by `build:helper`) so a future
 * import that drags in fastify, SQLite, or node_modules fails here instead
 * of stranding a switch mid-install. Slow suite only (issue #119): it
 * scans `dist/update-helper-meta.json` (written by `build:helper`), so it
 * runs after `mise run build` and FAILS when the bundle is absent.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(here, "..", "dist");
const metaFile = path.join(distRoot, "update-helper-meta.json");

/**
 * Source files the helper bundle may contain, each with its reason.
 * Everything else (fastify, SQLite stores, ACP, node_modules) is a
 * containment breach.
 */
const ALLOWED_INPUTS: { prefix: string; reason: string }[] = [
  { prefix: "src/update/", reason: "the pure update modules (seam, state, helper, entry)" },
  { prefix: "src/cli/lock.ts", reason: "lock read for the current-generation check (fs/http/path only)" },
  { prefix: "src/exec/runner.ts", reason: "RealCommandRunner for gh/npm (spawn only)" },
  { prefix: "src/exec/gh.ts", reason: "GITHUB_TOKEN-unset gh wrapper (type + runner only)" },
  { prefix: "src/store/paths.ts", reason: "dbFilePath for channel backups (fs/path only)" },
];

interface Metafile {
  inputs: Record<string, unknown>;
  outputs: Record<string, { imports?: { path: string; kind: string }[] }>;
}

describe("update-helper bundle containment", () => {
  it("bundles only the allowlisted sources and node builtins", () => {
    // The slow suite always builds first: a missing bundle is a failure,
    // never a skip (issue #119).
    if (!fs.existsSync(metaFile)) {
      throw new Error(`helper bundle not built: ${metaFile} missing (run \`mise run build\` first)`);
    }
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as Metafile;
    const offenders: string[] = [];
    for (const input of Object.keys(meta.inputs)) {
      if (input.includes("node_modules")) {
        offenders.push(`${input}: node_modules in the helper bundle`);
        continue;
      }
      if (!ALLOWED_INPUTS.some((a) => input === a.prefix || input.startsWith(a.prefix))) {
        offenders.push(`${input}: outside the helper allowlist`);
      }
    }
    expect(offenders, "helper bundle sources outside the allowlist").toEqual([]);
    expect(ALLOWED_INPUTS.length).toBeGreaterThan(0);

    const outputs = Object.entries(meta.outputs).filter(([name]) => name.endsWith("update-helper.js"));
    expect(outputs.length, "update-helper.js in the metafile outputs").toBeGreaterThan(0);
    const external = (outputs[0][1].imports ?? []).map((i) => i.path);
    expect(external.length, "helper bundle has runtime imports").toBeGreaterThan(0);
    expect(
      external.filter((p) => !p.startsWith("node:")),
      "non-builtin runtime imports in the helper bundle",
    ).toEqual([]);
  });
});
