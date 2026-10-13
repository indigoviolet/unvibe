import { defineConfig } from "vitest/config";
import { suiteOptions } from "../../vitest.shared.js";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // NOTE: test/acp-live.test.ts is NOT excluded here — it skips itself via
    // describe.skipIf(!LIVE) and runs with `npm run test:live` (UNVIBE_LIVE=1).
    // The `test`/`test:fast` scripts exclude it via CLI (`--exclude test/acp-live.test.ts`)
    // so `mise run check` never spends tokens. (A config-level exclude broke
    // `test:live` entirely: CLI positional filters cannot override it.)
    // (suiteOptions' exclude already covers node_modules/dist/.git/.cache
    // via configDefaults, plus *.disabled.test.* always and *.slow.test.*
    // under UNVIBE_TEST_SUITE=fast.)
    ...suiteOptions(["test/**/*.test.{ts,tsx}"]),
  },
});
