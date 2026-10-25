import { defineConfig } from "vite";

// Proxy both services through the dashboard's own origin, so the browser can
// read the merchant's PAYMENT-REQUIRED header without CORS setup.
export default defineConfig({
  envDir: "../..", // read VITE_* from the repo's .env
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3001", rewrite: (p) => p.replace(/^\/api/, "") },
      "/merchant": { target: "http://localhost:3000", rewrite: (p) => p.replace(/^\/merchant/, "") },
    },
  },
});
