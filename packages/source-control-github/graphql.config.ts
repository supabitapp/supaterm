import { defineConfig } from "@effect/graphql-generator/Config";

export default defineConfig({
  schema: "./schema/github.graphql",
  documents: ["src/**/*.graphql"],
  scalars: {
    GitObjectID: "effect/Schema#String",
    GitRefname: "effect/Schema#String",

    DateTime: "effect/Schema#String",
  },
});
