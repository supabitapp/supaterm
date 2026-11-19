import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      typecheck: {
        command: "astro check",
        cache: { input: [{ auto: true }, "!.astro/**"] },
      },
    },
  },
});
