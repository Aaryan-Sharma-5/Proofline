import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The build output is served by the Express gateway, not a separate host.
 *
 * That is deliberate: the gateway is the sole public origin (CLAUDE.md Section
 * 4), so the UI and the API share one origin. It keeps SSE simple (no CORS
 * preflight on the event stream), keeps the x402 boundary intact, and leaves
 * deployment as a single service.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Emitted where the gateway serves static files from.
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // In development the dev server proxies the API to the running gateway, so
    // the browser still only ever talks to one origin's API surface and the
    // code needs no environment-dependent base URL.
    proxy: {
      "/verify": "http://127.0.0.1:4021",
      "/demo": "http://127.0.0.1:4021",
      "/verification": "http://127.0.0.1:4021",
      "/health": "http://127.0.0.1:4021",
      "/docs": "http://127.0.0.1:4021",
      "/openapi.json": "http://127.0.0.1:4021",
    },
  },
});
