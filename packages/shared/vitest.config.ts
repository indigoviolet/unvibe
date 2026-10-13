import { defineConfig } from "vitest/config";
import { suiteOptions } from "../../vitest.shared.js";

export default defineConfig({
  test: {
    ...suiteOptions(["test/**/*.test.{ts,tsx}"]),
  },
});
