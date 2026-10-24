import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://supaterm.com",
  server: {
    port: Number(process.env.PORT ?? 4173),
  },
  vite: {
    build: {
      // Vite drops license banners by default; vendored MIT code has to ship its notice.
      rolldownOptions: { output: { comments: { legal: true } } },
    },
  },
});
