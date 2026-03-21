import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  plugins: [react()],
});
