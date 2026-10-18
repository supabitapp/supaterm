import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

import { BRAND_ASSET_PATHS, DEVELOPMENT_PUBLIC_ICON_OVERRIDES } from "./brand-assets.ts";
import { encodePngIco } from "./icon-export.ts";

class IconDerivativeError extends Schema.TaggedError<IconDerivativeError>()("IconDerivativeError", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

export const generateBrandIconDerivatives = Effect.fn("generateBrandIconDerivatives")(function* (
  repositoryRoot: string,
  icons: ReadonlyMap<string, Buffer>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const generated = new Map<string, Buffer>();
  const required = (source: string) => {
    const contents = icons.get(source);
    if (!contents) throw new Error(`Generated icon is missing: ${source}`);
    return contents;
  };
  const addRendered = (target: string, run: () => Promise<Buffer>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => new IconDerivativeError({ path: target, cause }),
    }).pipe(Effect.tap((contents) => Effect.sync(() => generated.set(target, contents))));

  for (const override of DEVELOPMENT_PUBLIC_ICON_OVERRIDES) {
    generated.set(override.targetRelativePath, required(override.sourceRelativePath));
  }
  generated.set(
    "apps/marketing/public/favicon-16x16.png",
    required(BRAND_ASSET_PATHS.productionWebFavicon16Png),
  );
  generated.set(
    "apps/marketing/public/favicon-32x32.png",
    required(BRAND_ASSET_PATHS.productionWebFavicon32Png),
  );
  yield* addRendered("apps/marketing/public/favicon.ico", async () =>
    encodePngIco([
      { size: 16, contents: required(BRAND_ASSET_PATHS.productionWebFavicon16Png) },
      { size: 32, contents: required(BRAND_ASSET_PATHS.productionWebFavicon32Png) },
      {
        size: 48,
        contents: await sharp(required(BRAND_ASSET_PATHS.productionLinuxIconPng))
          .resize(48, 48)
          .png()
          .toBuffer(),
      },
    ]),
  );
  yield* addRendered("apps/marketing/public/apple-touch-icon.png", () =>
    sharp(required(BRAND_ASSET_PATHS.productionWebAppleTouchIconPng))
      .png({ palette: true, compressionLevel: 9 })
      .toBuffer(),
  );
  for (const [target, source] of [
    ["apps/marketing/src/assets/icon.webp", BRAND_ASSET_PATHS.productionMacIconPng],
    ["apps/marketing/src/assets/icon-nightly.webp", BRAND_ASSET_PATHS.nightlyMacIconPng],
  ] as const) {
    yield* addRendered(target, () =>
      sharp(required(source)).webp({ quality: 85, alphaQuality: 100 }).toBuffer(),
    );
  }

  const androidStoreIcon = yield* Effect.tryPromise({
    try: () =>
      sharp(required("apps/mobile/assets/android-icon-prod.png")).resize(256, 256).png().toBuffer(),
    catch: (cause) =>
      new IconDerivativeError({ path: "apps/mobile/fastlane/feature-graphic.svg", cause }),
  });
  for (const [target, contents] of [
    [
      "apps/desktop/resources/dmg/dmg-background-latest.svg",
      required(BRAND_ASSET_PATHS.productionWebAppleTouchIconPng),
    ],
    [
      "apps/desktop/resources/dmg/dmg-background-nightly.svg",
      required(BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng),
    ],
    ["apps/mobile/fastlane/feature-graphic.svg", androidStoreIcon],
  ] as const) {
    const template = yield* fs.readFileString(path.join(repositoryRoot, target));
    const updated = yield* Effect.try({
      try: () => {
        const [tag, ...others] = template.match(/<image\b[^>]*\bid="app-icon"[^>]*>/g) ?? [];
        if (!tag || others.length > 0 || !/\bhref="[^"]*"/.test(tag)) {
          throw new Error(`Expected one image with id="app-icon" and an href in ${target}`);
        }
        return template.replace(
          tag,
          tag.replace(
            /\bhref="[^"]*"/,
            `href="data:image/png;base64,${contents.toString("base64")}"`,
          ),
        );
      },
      catch: (cause) => new IconDerivativeError({ path: target, cause }),
    });
    generated.set(target, Buffer.from(updated));
  }
  return generated;
});
