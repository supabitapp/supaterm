import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import sharp from "sharp";

import {
  ICON_CHANNELS,
  SCREEN_ART_SIZE,
  type IconChannel,
  type StudioIconRender,
} from "./studio-icon-render.ts";

const ADAPTIVE_CANVAS = 432;
const SPLASH_CANVAS = 1152;
const LEGACY_CANVAS = 1024;
const OUTPUT_DIRECTORY = "apps/mobile/assets";

export class AndroidIconRenderError extends Schema.TaggedError<AndroidIconRenderError>()(
  "AndroidIconRenderError",
  { layer: Schema.String, cause: Schema.Defect() },
) {}

const render = <A>(layer: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new AndroidIconRenderError({ layer, cause }) });

const resized = (channel: IconChannel, artwork: Buffer, size: number) =>
  render(`${channel}-${size}`, () => sharp(artwork).resize(size, size).png().toBuffer());

// Launchers show the middle two thirds of the adaptive canvas, so legacy icons and in-app
// branding use that crop.
const visible = (channel: IconChannel, artwork: Buffer) =>
  render(`${channel}-legacy`, () => {
    const side = Math.floor((SCREEN_ART_SIZE * 2) / 3);
    const inset = (SCREEN_ART_SIZE - side) / 2;
    return sharp(artwork)
      .extract({ left: inset, top: inset, width: side, height: side })
      .resize(LEGACY_CANVAS, LEGACY_CANVAS)
      .png()
      .toBuffer();
  });

export const generateAndroidIcons = Effect.fn("generateAndroidIcons")(function* (
  renders: Readonly<Record<IconChannel, StudioIconRender>>,
) {
  const generated = new Map<string, Buffer>();
  const add = (name: string, contents: Buffer) =>
    generated.set(`${OUTPUT_DIRECTORY}/${name}`, contents);
  add(
    "android-icon-foreground.png",
    yield* render("foreground", () =>
      sharp({
        create: {
          width: ADAPTIVE_CANVAS,
          height: ADAPTIVE_CANVAS,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .png()
        .toBuffer(),
    ),
  );
  for (const channel of ICON_CHANNELS) {
    const artwork = renders[channel].screenArt;
    add(`android-icon-${channel}.png`, yield* visible(channel, artwork));
    add(
      `android-icon-background-${channel}.png`,
      yield* resized(channel, artwork, ADAPTIVE_CANVAS),
    );
    add(`android-splash-icon-${channel}.png`, yield* resized(channel, artwork, SPLASH_CANVAS));
  }
  return generated;
});
