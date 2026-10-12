import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

/**
 * Emit `dist/web-meta.json` (issue #14): the esbuild-metafile-shaped module
 * list the release notices are generated from (`{ inputs: { <id>: {} } }`
 * for every bundled `node_modules/` module, same shape as the service
 * `dist/meta.json` files). Rollup has no built-in metafile, so this plugin
 * collects module ids at `generateBundle` time instead of a hand-kept list:
 * React, the state library, the `@fontsource/*` packages, etc. are whatever
 * the build actually compiled in.
 */
function webMetaPlugin(): Plugin {
  return {
    name: "unvibe-web-meta",
    generateBundle() {
      const inputs: Record<string, object> = {};
      for (const id of this.getModuleIds()) {
        if (!id.includes("node_modules/")) continue;
        inputs[id] = {};
      }
      this.emitFile({ type: "asset", fileName: "web-meta.json", source: JSON.stringify({ inputs }, null, 2) });
    },
  };
}

// Dev: the service runs on 127.0.0.1:4517 (UNVIBE_PORT); proxy API + WS there.
export default defineConfig(({ command, mode }) => ({
  plugins: [react(), webMetaPlugin()],
  define: {
    // Dev-only Sentry (issue #29): the DSN reaches the app only in the Vite
    // dev server. Builds and tests get "", which drops the SDK entirely.
    __SENTRY_DSN__: JSON.stringify(
      command === "serve" && mode !== "test" ? (process.env.SENTRY_DSN_REACT ?? "") : "",
    ),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4517",
        changeOrigin: false,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
}));
