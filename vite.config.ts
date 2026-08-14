import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export function createApiProxyOptions(localProxyToken: string | undefined) {
  return {
    target: "http://127.0.0.1:3001",
    headers: localProxyToken
      ? { "x-stackfolio-local-proxy-token": localProxyToken }
      : {},
  };
}

export default defineConfig({
  plugins: [react()],
  root: ".",
  server: {
    port: 5173,
    proxy: {
      "/api": createApiProxyOptions(process.env.STACKFOLIO_LOCAL_PROXY_TOKEN),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
