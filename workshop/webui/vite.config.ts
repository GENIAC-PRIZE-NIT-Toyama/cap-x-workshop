import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the backend (see workshop/backend/main.py, default
// port 8200). In production the backend serves this app's build output from
// the same origin (WORKSHOP_WEBUI_SPEC.md section 2/3.2), so no proxy is
// needed there and the frontend only ever calls relative "/api/..." paths.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // ws: true so the /api/sessions/{id}/stream websocket also proxies in
      // dev (Vite's http-proxy doesn't upgrade websocket connections unless
      // told to) — production doesn't need this, the backend serves the
      // built app from the same origin (see api.ts's streamUrl()).
      "/api": { target: "http://localhost:8200", ws: true },
    },
  },
});
