import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dev: the service runs on 127.0.0.1:4517 (UNVIBE_PORT); proxy API + WS there.
export default defineConfig({
  plugins: [react()],
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
});
