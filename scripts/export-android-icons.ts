#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

const ICON_VARIANTS = ["dev", "nightly", "prod"] as const;
type IconVariant = (typeof ICON_VARIANTS)[number];

const ADAPTIVE_CANVAS = 432;
const SPLASH_CANVAS = 1152;
const OUTPUT_DIRECTORY = "apps/mobile/assets";

export class AndroidIconRenderError extends Schema.TaggedError<AndroidIconRenderError>()(
  "AndroidIconRenderError",
  { layer: Schema.String, cause: Schema.Defect() },
) {}

const transparentCanvas = (size: number) =>
  sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  });

const render = <A>(layer: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new AndroidIconRenderError({ layer, cause }) });

const IconComposerDocument = Schema.Struct({
  groups: Schema.Array(
    Schema.Struct({ layers: Schema.Array(Schema.Struct({ "image-name": Schema.String })) }),
  ),
});
const decodeIconComposerDocument = Schema.decodeUnknownEffect(
  Schema.fromJsonString(IconComposerDocument),
);

const readArtwork = Effect.fn("androidIcons.readArtwork")(function* (
  repositoryRoot: string,
  variant: IconVariant,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const project = path.join(repositoryRoot, "assets", variant, "app-icon.icon");
  const document = yield* fs
    .readFileString(path.join(project, "icon.json"))
    .pipe(Effect.flatMap(decodeIconComposerDocument));
  const layers = document.groups.toReversed().flatMap((group) => group.layers.toReversed());
  const images = yield* Effect.forEach(layers, (layer) =>
    fs
      .readFile(path.join(project, "Assets", layer["image-name"]))
      .pipe(
        Effect.flatMap((contents) =>
          render(variant, () => sharp(contents).resize(1024, 1024).png().toBuffer()),
        ),
      ),
  );
  return yield* render(variant, () =>
    transparentCanvas(1024)
      .composite(images.map((input) => ({ input })))
      .png()
      .toBuffer(),
  );
});

const renderBackground = (variant: IconVariant, artwork: Uint8Array, size: number) =>
  render(`${variant}-background`, async () => {
    const visible = Math.round((size * 2) / 3);
    const inset = Math.round((size - visible) / 2);
    const corner = await sharp(artwork)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    const casing = { r: corner[0]!, g: corner[1]!, b: corner[2]!, alpha: 1 };
    const fitted = await sharp(artwork).resize(visible, visible).png().toBuffer();
    return sharp({ create: { width: size, height: size, channels: 4, background: casing } })
      .composite([{ input: fitted, left: inset, top: inset }])
      .png()
      .toBuffer();
  });

const renderTransparent = (size: number) =>
  render("foreground", () => transparentCanvas(size).png().toBuffer());

const exportAndroidIcons = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const write = Effect.fn("androidIcons.write")(function* (name: string, contents: Uint8Array) {
    yield* fs.writeFile(path.join(repositoryRoot, OUTPUT_DIRECTORY, name), contents);
    yield* Console.log(`wrote ${OUTPUT_DIRECTORY}/${name}`);
  });
  yield* write("android-icon-foreground.png", yield* renderTransparent(ADAPTIVE_CANVAS));
  for (const variant of ICON_VARIANTS) {
    const artwork = yield* readArtwork(repositoryRoot, variant);
    yield* write(
      `android-icon-background-${variant}.png`,
      yield* renderBackground(variant, artwork, ADAPTIVE_CANVAS),
    );
    yield* write(
      `android-splash-icon-${variant}.png`,
      yield* renderBackground(variant, artwork, SPLASH_CANVAS),
    );
  }
});

if (import.meta.main) {
  exportAndroidIcons.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
