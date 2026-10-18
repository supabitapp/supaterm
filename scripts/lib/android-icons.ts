import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

const ICON_VARIANTS = ["dev", "nightly", "prod"] as const;
type IconVariant = (typeof ICON_VARIANTS)[number];

const ADAPTIVE_CANVAS = 432;
const SPLASH_CANVAS = 1152;
const COMPOSER_CANVAS = 1024;
const CRT_CROP = { left: 256, top: 206, width: 512, height: 512 };
const CRT_CENTER_OFFSET = COMPOSER_CANVAS / 2 - (CRT_CROP.top + CRT_CROP.height / 2);
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

const readArtwork = Effect.fn("androidIcons.readArtwork")(function* (
  repositoryRoot: string,
  variant: IconVariant,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const project = path.join(repositoryRoot, "assets", variant, "app-icon.icon");
  const readLayer = (file: string) =>
    fs
      .readFile(path.join(project, "Assets", file))
      .pipe(
        Effect.flatMap((contents) =>
          render(variant, () =>
            sharp(contents).resize(COMPOSER_CANVAS, COMPOSER_CANVAS).png().toBuffer(),
          ),
        ),
      );
  const { housing, screen, glow, bolt } = yield* Effect.all(
    {
      housing: readLayer("01-Tactile-Housing.png"),
      screen: readLayer("02-CRT-Screen.svg"),
      glow: readLayer("04-Phosphor-Glow.svg"),
      bolt: readLayer("05-Glass-Lightning.svg"),
    },
    { concurrency: "unbounded" },
  );
  return yield* render(variant, async () => {
    const glass = await sharp(housing)
      .composite([{ input: screen }])
      .png()
      .toBuffer();
    const background = await sharp(glass)
      .extract(CRT_CROP)
      .resize(COMPOSER_CANVAS, COMPOSER_CANVAS)
      .png()
      .toBuffer();
    const foreground = await transparentCanvas(COMPOSER_CANVAS)
      .composite([{ input: glow }, { input: bolt }])
      .png()
      .toBuffer();
    const centered = await sharp(foreground)
      .extract({
        left: 0,
        top: 0,
        width: COMPOSER_CANVAS,
        height: COMPOSER_CANVAS - CRT_CENTER_OFFSET,
      })
      .extend({
        top: CRT_CENTER_OFFSET,
        bottom: 0,
        left: 0,
        right: 0,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    return sharp(background)
      .composite([{ input: centered }])
      .png()
      .toBuffer();
  });
});

const renderBackground = (variant: IconVariant, artwork: Uint8Array, size: number) =>
  render(`${variant}-background`, () => sharp(artwork).resize(size, size).png().toBuffer());

const renderLegacy = (variant: IconVariant, artwork: Uint8Array) =>
  render(`${variant}-legacy`, () => {
    const visible = Math.floor((COMPOSER_CANVAS * 2) / 3);
    const inset = (COMPOSER_CANVAS - visible) / 2;
    return sharp(artwork)
      .extract({ left: inset, top: inset, width: visible, height: visible })
      .resize(COMPOSER_CANVAS, COMPOSER_CANVAS)
      .png()
      .toBuffer();
  });

export const generateAndroidIcons = Effect.fn("generateAndroidIcons")(function* (
  sourceRoot: string,
) {
  const generated = new Map<string, Buffer>();
  const add = (name: string, contents: Buffer) =>
    generated.set(`${OUTPUT_DIRECTORY}/${name}`, contents);
  add(
    "android-icon-foreground.png",
    yield* render("foreground", () => transparentCanvas(ADAPTIVE_CANVAS).png().toBuffer()),
  );
  for (const variant of ICON_VARIANTS) {
    const artwork = yield* readArtwork(sourceRoot, variant);
    add(`android-icon-${variant}.png`, yield* renderLegacy(variant, artwork));
    add(
      `android-icon-background-${variant}.png`,
      yield* renderBackground(variant, artwork, ADAPTIVE_CANVAS),
    );
    add(
      `android-splash-icon-${variant}.png`,
      yield* renderBackground(variant, artwork, SPLASH_CANVAS),
    );
  }
  return generated;
});
