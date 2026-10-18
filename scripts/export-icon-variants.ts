#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { recolorBoltSvg } from "./lib/icon-artwork.ts";

const BOLT_HUES = { nightly: 285, dev: 195 } as const;

export class IconVariantError extends Schema.TaggedError<IconVariantError>()("IconVariantError", {
  variant: Schema.String,
  cause: Schema.Defect(),
}) {}

const exportIconVariants = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const check = process.argv.includes("--check");
  const production = path.join(repositoryRoot, "assets", "prod", "app-icon.icon");
  const assets = yield* fs.readDirectory(path.join(production, "Assets"));
  const files = ["icon.json", ...assets.map((name) => path.join("Assets", name))];
  const stale: Array<string> = [];
  for (const [variant, hue] of Object.entries(BOLT_HUES)) {
    const destination = path.join(repositoryRoot, "assets", variant, "app-icon.icon");
    if (!check) {
      yield* fs.makeDirectory(path.join(destination, "Assets"), { recursive: true });
    }
    for (const relative of files) {
      const source = yield* fs.readFile(path.join(production, relative));
      const name = path.basename(relative);
      const contents =
        name === "04-Phosphor-Glow.svg" || name === "05-Glass-Lightning.svg"
          ? Buffer.from(recolorBoltSvg(Buffer.from(source).toString("utf8"), hue))
          : Buffer.from(source);
      const file = path.join(destination, relative);
      if (check) {
        const exists = yield* fs.exists(file);
        if (!exists || !contents.equals(Buffer.from(yield* fs.readFile(file)))) stale.push(file);
      } else {
        yield* fs.writeFile(file, contents);
        yield* Console.log(`wrote ${path.relative(repositoryRoot, file)}`);
      }
    }
  }
  if (stale.length > 0) {
    return yield* new IconVariantError({
      variant: "check",
      cause: `stale icon variants, run vp run icons:variants: ${stale.join(", ")}`,
    });
  }
});

if (import.meta.main) {
  exportIconVariants.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
