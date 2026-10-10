import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["node_modules", "dist", ".git", ".cache", "test/acp-live.test.ts"],
  },
});
