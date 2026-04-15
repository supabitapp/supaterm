import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildDownloadTargetUrl, githubOrigin } from "./src/lib/downloads.ts";

const rewriteDownloadPath = (path: string) => {
  const targetUrl = buildDownloadTargetUrl(new URL(path, githubOrigin));
  return targetUrl ? `${targetUrl.pathname}${targetUrl.search}` : path;
};

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  server: {
    proxy: {
      "/download/latest/": {
        target: githubOrigin,
        changeOrigin: true,
        rewrite: rewriteDownloadPath,
      },
      "/download/tip/": {
        target: githubOrigin,
        changeOrigin: true,
        rewrite: rewriteDownloadPath,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [react(), tailwindcss()],
});
