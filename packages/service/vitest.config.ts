import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // NOTE: test/acp-live.test.ts is NOT excluded here — it skips itself via
    // describe.skipIf(!LIVE) and runs with `npm run test:live` (UNVIBE_LIVE=1).
    // The `test` script excludes it via CLI (`--exclude test/acp-live.test.ts`)
    // so `mise run check` never spends tokens. (A config-level exclude broke
    // `test:live` entirely: CLI positional filters cannot override it.)
    exclude: ["node_modules", "dist", ".git", ".cache"],
  },
});
