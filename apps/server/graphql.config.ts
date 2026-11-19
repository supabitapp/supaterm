import { defineConfig } from "@effect/graphql-generator/Config";

export default defineConfig({
  schema: "./schema/expo.graphql",
  documents: ["src/device/**/*.graphql"],
});
