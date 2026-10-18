// @effect-diagnostics nodeBuiltinImport:off - Store assets are prepared on the CI host.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import sharp from "sharp";

import showcaseConfig, { type ShowcaseConfig } from "./mobile-showcase.config.ts";
import { validateStoreAsset, validateStoreAssetCount } from "./mobile-showcase.ts";

const REPO_ROOT = NodeURL.fileURLToPath(new URL("../", import.meta.url));

export async function prepareMobileStoreAssets(
  input: {
    platform: "ios" | "android";
    screenshotRoot: string;
    outputRoot: string;
  },
  config: ShowcaseConfig = showcaseConfig,
) {
  const output = NodePath.join(input.outputRoot, input.platform);
  const assets = [];
  for (const device of config.devices.filter((device) => device.platform === input.platform)) {
    validateStoreAssetCount(device.storeAsset, device.scenes.length, true);
    for (const [index, scene] of device.scenes.entries()) {
      const source = NodePath.join(
        input.screenshotRoot,
        device.storeAsset.directory,
        "dark",
        "supaterm",
        `${scene}.png`,
      );
      const data = await NodeFSP.readFile(source);
      validateStoreAsset(device.storeAsset, data);
      const filename = `${String(index + 1).padStart(2, "0")}_${scene}_${device.id}.png`;
      const directory =
        device.storeAsset.store === "apple"
          ? NodePath.join(output, "en-US")
          : NodePath.join(output, "en-US", "images", device.storeAsset.screenshotType);
      assets.push({ destination: NodePath.join(directory, filename), data });
    }
  }
  await NodeFSP.rm(output, { recursive: true, force: true });
  for (const asset of assets) {
    await NodeFSP.mkdir(NodePath.dirname(asset.destination), { recursive: true });
    await NodeFSP.writeFile(asset.destination, asset.data);
  }
  if (input.platform === "android") {
    const images = NodePath.join(output, "en-US", "images");
    await sharp(NodePath.join(REPO_ROOT, "apps/mobile/assets/android-icon-prod.png"))
      .resize(512, 512)
      .removeAlpha()
      .png()
      .toFile(NodePath.join(images, "icon.png"));
    await sharp(NodePath.join(REPO_ROOT, "apps/mobile/fastlane/feature-graphic.svg"))
      .flatten({ background: "#080808" })
      .removeAlpha()
      .png()
      .toFile(NodePath.join(images, "featureGraphic.png"));
  }
  return { output, count: assets.length };
}

if (NodeProcess.argv[1] && NodeURL.pathToFileURL(NodeProcess.argv[1]).href === import.meta.url) {
  const platform = NodeProcess.argv[2];
  if (platform !== "ios" && platform !== "android") {
    throw new Error("Usage: node scripts/mobile-store-assets.ts <ios|android>");
  }
  const result = await prepareMobileStoreAssets({
    platform,
    screenshotRoot: NodePath.join(REPO_ROOT, showcaseConfig.outputDirectory),
    outputRoot: NodePath.join(REPO_ROOT, "artifacts/app-store/fastlane"),
  });
  NodeProcess.stdout.write(
    `Prepared ${result.count} validated ${platform} screenshots in ${result.output}.\n`,
  );
}
