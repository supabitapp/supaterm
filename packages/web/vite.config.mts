import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const serverUrl = process.env.VITE_SERVER_URL ?? "http://localhost:7681";
const wsUrl = serverUrl.replace(/^http/, "ws");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __SERVER_URL__: JSON.stringify(serverUrl),
  },
  server: {
    port: 5173,
    proxy: {
      "/pty": { target: wsUrl, ws: true, changeOrigin: true },
      "/control": { target: wsUrl, ws: true, changeOrigin: true },
      "/api": { target: serverUrl, changeOrigin: true },
    },
  },
});
