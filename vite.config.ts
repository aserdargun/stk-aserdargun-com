import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export function createApiProxyOptions(
  localProxyToken: string | undefined,
  apiPort: string | number = process.env.STACKFOLIO_API_PORT || 3001,
) {
  return {
    target: `http://127.0.0.1:${apiPort}`,
    headers: localProxyToken
      ? { "x-stackfolio-local-proxy-token": localProxyToken }
      : {},
  };
}

export default defineConfig({
  plugins: [react()],
  root: ".",
  server: {
    port: Number(process.env.STACKFOLIO_VITE_PORT || 5173),
    proxy: {
      "/api": createApiProxyOptions(
        process.env.STACKFOLIO_LOCAL_PROXY_TOKEN,
        process.env.STACKFOLIO_API_PORT,
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
