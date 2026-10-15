// DISABLED(#188): pins adapter file names
/**
 * Adapter entry resolution (`agent/acp/connection.ts`).
 *
 * In a source checkout (this test runs from `src/`), there is no
 * `dist/adapters/` next to the module, so resolution falls back to the
 * adapter packages in node_modules. In the release tree only the bundled
 * `dist/adapters/*.js` files exist, and the bundled-first branch is taken
 * (covered by the installed-copy live run, `test:live:installed`, where
 * node_modules has no adapter packages at all).
 */
import { describe, expect, it } from "vitest";
import { ADAPTER_FILE, resolveAdapterEntry } from "../src/agent/acp/connection.js";

describe("resolveAdapterEntry", () => {
  // DISABLED(#119): restates the ADAPTER_FILE constant; the real files are checked by the global-install gate.
  it.skip("maps providers to bundled file names", () => {
    expect(ADAPTER_FILE).toEqual({ claude: "claude.js", codex: "codex.js" });
  });

  it("falls back to node_modules in a source checkout", () => {
    for (const provider of ["claude", "codex"] as const) {
      const entry = resolveAdapterEntry(provider);
      expect(entry).toMatch(/node_modules\/@agentclientprotocol\/.*\/dist\/index\.js$/);
    }
  });
});
