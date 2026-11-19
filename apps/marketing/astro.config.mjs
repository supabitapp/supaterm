import { defineConfig } from "astro/config";

delete process.env.VP_RUN_NODE_CLIENT_PATH;

export default defineConfig({
  site: "https://supaterm.com",
  server: {
    port: Number(process.env.PORT ?? 4173),
  },
  vite: {
    build: {
      rolldownOptions: { output: { comments: { legal: true } } },
    },
  },
});
