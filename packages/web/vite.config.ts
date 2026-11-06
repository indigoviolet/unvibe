import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { suiteOptions } from "../../vitest.shared.js";

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
const tracesOn = process.env.UNVIBE_DEBUG_TRACES === "1";

// Lean builds (issue #356, debug flavour) alias every OTel package to a
// stub so no tracing code ships; debug builds bundle the real SDK.
const tracesAlias = tracesOn
  ? {}
  : Object.fromEntries(
      [
        "@opentelemetry/api",
        "@opentelemetry/sdk-trace-base",
        "@opentelemetry/sdk-trace-web",
        "@opentelemetry/context-zone",
        "@opentelemetry/instrumentation",
        "@opentelemetry/instrumentation-document-load",
        "@opentelemetry/instrumentation-fetch",
        "@opentelemetry/instrumentation-user-interaction",
        "zone.js",
      ].map((name) => [name, new URL("./src/traces/stub.ts", import.meta.url).pathname]),
    );

export default defineConfig(({ command, mode }) => ({
  plugins: [react(), webMetaPlugin()],
  define: {
    // Dev-only Sentry (issue #29): the DSN reaches the app only in the Vite
    // dev server. Builds and tests get "", which drops the SDK entirely.
    __SENTRY_DSN__: JSON.stringify(
      command === "serve" && mode !== "test" ? (process.env.SENTRY_DSN_REACT ?? "") : "",
    ),
    // Debug flavour (issue #356): the browser SDK loads only in debug
    // builds; lean builds show the install notice instead of recording.
    __UNVIBE_TRACES__: JSON.stringify(tracesOn),
  },
  resolve: {
    alias: tracesAlias,
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
  // Static demo (#334, `VITE_DEMO=1`): relative base so the build runs
  // from any static subpath (`/demo` on GitHub Pages).
  base: process.env.VITE_DEMO === "1" ? "./" : "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    setupFiles: ["./vitest.setup.ts"],
    // Fast/slow split (issue #119): UNVIBE_TEST_SUITE=fast skips
    // *.slow.test.*, =slow runs only those; worker caps in vitest.shared.ts.
    ...suiteOptions(["src/**/*.test.{ts,tsx}"]),
  },
}));
