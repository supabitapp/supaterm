// @effect-diagnostics nodeBuiltinImport:off - Store packaging runs on the CI host.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, expect, it } from "@effect/vitest";
import { PNG } from "pngjs";

import showcaseConfig, { type ShowcaseConfig } from "./mobile-showcase.config.ts";
import { normalizeStorePng, readPngMetadata } from "./mobile-showcase.ts";
import { prepareMobileStoreAssets } from "./mobile-store-assets.ts";

const config: ShowcaseConfig = {
  captureDirectory: "captures",
  outputDirectory: "screenshots",
  slides: showcaseConfig.slides,
  metroPort: 8199,
  settleDelayMs: 1,
  devices: [
    {
      id: "tablet",
      platform: "android",
      avd: "Test_Tablet",
      frame: "android-tablet",
      appearance: "dark",
      theme: "supaterm",
      scenes: ["terminal", "thread"],
      storeAsset: {
        store: "google-play",
        screenshotType: "sevenInchScreenshots",
        directory: "google-play/custom-tablet",
        width: 360,
        height: 640,
        minimumUploadCount: 2,
        maximumUploadCount: 8,
      },
    },
  ],
};

function screenshot(value: number) {
  const png = new PNG({ width: 360, height: 640 });
  png.data.fill(value);
  return normalizeStorePng(PNG.sync.write(png));
}

it("packages configured screenshot order and store slots with upload-safe branding", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mobile-store-assets-"));
  try {
    const screenshotRoot = NodePath.join(root, "screenshots");
    const source = NodePath.join(screenshotRoot, "google-play/custom-tablet/dark/supaterm");
    await NodeFSP.mkdir(source, { recursive: true });
    const terminal = screenshot(80);
    const thread = screenshot(160);
    await NodeFSP.writeFile(NodePath.join(source, "terminal.png"), terminal);
    await NodeFSP.writeFile(NodePath.join(source, "thread.png"), thread);
    const result = await prepareMobileStoreAssets(
      { platform: "android", screenshotRoot, outputRoot: NodePath.join(root, "output") },
      config,
    );
    assert.equal(result.count, 2);
    const images = NodePath.join(result.output, "en-US/images");
    const screenshots = NodePath.join(images, "sevenInchScreenshots");
    assert.deepStrictEqual(await NodeFSP.readdir(screenshots), [
      "01_terminal_tablet.png",
      "02_thread_tablet.png",
    ]);
    assert.deepStrictEqual(
      await NodeFSP.readFile(NodePath.join(screenshots, "01_terminal_tablet.png")),
      terminal,
    );
    assert.deepStrictEqual(
      await NodeFSP.readFile(NodePath.join(screenshots, "02_thread_tablet.png")),
      thread,
    );
    for (const [filename, width, height] of [
      ["icon.png", 512, 512],
      ["featureGraphic.png", 1024, 500],
    ] as const) {
      assert.deepStrictEqual(
        readPngMetadata(await NodeFSP.readFile(NodePath.join(images, filename))),
        {
          width,
          height,
          bitDepth: 8,
          colorType: 2,
          hasAlpha: false,
        },
      );
    }
    await NodeFSP.writeFile(NodePath.join(source, "thread.png"), "invalid PNG");
    await expect(
      prepareMobileStoreAssets(
        { platform: "android", screenshotRoot, outputRoot: NodePath.join(root, "output") },
        config,
      ),
    ).rejects.toThrow(/not a valid PNG/u);
    assert.deepStrictEqual(
      await NodeFSP.readFile(NodePath.join(screenshots, "02_thread_tablet.png")),
      thread,
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
