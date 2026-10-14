import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Service sources import the shared package by name; point it at the
    // sources so the spike needs no `dist/`.
    alias: { "@unvibe/shared": path.resolve(root, "../../packages/shared/src/index.ts") },
  },
  test: {
    root,
    include: ["test/**/*.test.ts"],
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 20_000,
  },
});
