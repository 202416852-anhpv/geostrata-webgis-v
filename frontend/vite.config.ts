import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Chạy local: http://localhost:8000. Chạy trong docker compose dev: http://backend:8000.
  const apiTarget = env.VITE_API_PROXY_TARGET ?? "http://localhost:8000";

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
      },
      // Bind mount qua Docker trên Windows/macOS không bắn sự kiện inotify.
      watch: env.VITE_USE_POLLING === "true" ? { usePolling: true, interval: 300 } : undefined,
    },
    build: {
      outDir: "dist",
      sourcemap: mode !== "production",
    },
  };
});
