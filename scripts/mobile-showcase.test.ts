// @effect-diagnostics nodeBuiltinImport:off - expectations mirror the host path joins the script under test performs.
import * as NodePath from "node:path";
import { assert, it } from "@effect/vitest";
import { PNG } from "pngjs";

import showcaseConfig, {
  SHOWCASE_THEMES,
  DEFAULT_SHOWCASE_THEME,
  type ShowcaseConfig,
  type ShowcaseStoreAssetSpec,
} from "./mobile-showcase.config.ts";
import {
  SHOWCASE_ENVIRONMENTS,
  SHOWCASE_PROJECTS,
  SHOWCASE_THREADS,
} from "./mobile-showcase-environment.ts";
import {
  encodeAndroidPairingUrls,
  normalizeStorePng,
  parseShowcaseCliArgs,
  parsePairingCredentialOutput,
  planShowcaseCaptures,
  readPngMetadata,
  showcaseCaptureDirectory,
} from "./mobile-showcase.ts";

const appleSpec: ShowcaseStoreAssetSpec = {
  store: "apple",
  directory: "apple/iphone-test",
  width: 1284,
  height: 2778,
  minimumUploadCount: 1,
  maximumUploadCount: 10,
};

const googleSpec: ShowcaseStoreAssetSpec = {
  store: "google-play",
  screenshotType: "phoneScreenshots",
  directory: "google-play/phone",
  width: 1080,
  height: 1920,
  minimumUploadCount: 2,
  maximumUploadCount: 8,
  maximumFileSizeBytes: 8 * 1024 * 1024,
};

const config: ShowcaseConfig = {
  outputDirectory: "artifacts",
  metroPort: 8199,
  settleDelayMs: 1,
  devices: [
    {
      id: "phone",
      platform: "ios",
      simulator: "iPhone Test",
      appearance: "dark",
      theme: "supaterm",
      scenes: ["thread", "review"],
      storeAsset: appleSpec,
    },
    {
      id: "pixel",
      platform: "android",
      avd: "Pixel_Test",
      appearance: "light",
      theme: "supaterm",
      scenes: ["thread", "terminal"],
      storeAsset: googleSpec,
    },
  ],
};

it("parses repeatable and expanded theme filters", () => {
  assert.deepStrictEqual(
    [...parseShowcaseCliArgs(["--theme", "nord", "--theme", "tokyo-night"]).themes],
    ["nord", "tokyo-night"],
  );
  assert.deepStrictEqual(
    [...parseShowcaseCliArgs(["--theme", "all"]).themes],
    [...SHOWCASE_THEMES],
  );
});

it("expands themes into independent upload-ready directories per appearance", () => {
  const options = parseShowcaseCliArgs([
    "--device",
    "phone",
    "--appearance",
    "both",
    "--theme",
    "nord",
    "--theme",
    "tokyo-night",
  ]);

  assert.deepStrictEqual(
    planShowcaseCaptures(config, options).map((capture) =>
      showcaseCaptureDirectory("/captures", capture),
    ),
    [
      NodePath.join("/captures", "apple", "iphone-test", "dark", "nord"),
      NodePath.join("/captures", "apple", "iphone-test", "dark", "tokyo-night"),
    ],
  );
});

it("rejects captures with an unsupported theme appearance", () => {
  const options = parseShowcaseCliArgs([
    "--device",
    "phone",
    "--appearance",
    "light",
    "--theme",
    "nord",
  ]);
  assert.throws(() => planShowcaseCaptures(config, options), /No captures match/u);
});

function rgbaPng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(255);
  return PNG.sync.write(png);
}

it("converts simulator RGBA captures to upload-safe 24-bit RGB PNGs", () => {
  const normalized = normalizeStorePng(rgbaPng(2, 3));
  assert.deepStrictEqual(readPngMetadata(normalized), {
    width: 2,
    height: 3,
    bitDepth: 8,
    colorType: 2,
    hasAlpha: false,
  });
});

it("defaults every device to the app's own palette", () => {
  assert.equal(DEFAULT_SHOWCASE_THEME, "supaterm");
  assert.equal(
    showcaseConfig.devices.every((device) => device.theme === DEFAULT_SHOWCASE_THEME),
    true,
  );
});

it("configures every default device with an exact upload-ready store target", () => {
  assert.deepStrictEqual(
    showcaseConfig.devices.map((device) => [
      device.id,
      device.platform === "ios" ? (device.orientation ?? "portrait") : null,
      device.storeAsset.directory,
      device.storeAsset.width,
      device.storeAsset.height,
    ]),
    [
      ["iphone-6.9", "portrait", "apple/iphone-6.9", 1320, 2868],
      ["iphone-6.3", "portrait", "apple/iphone-6.3", 1206, 2622],
      ["iphone-6.5", "portrait", "apple/iphone-6.5", 1284, 2778],
      ["ipad-13", "landscape", "apple/ipad-13", 2752, 2064],
      ["pixel", null, "google-play/phone", 1080, 1920],
      ["android-tablet-7", null, "google-play/tablet-7", 1080, 1920],
      ["android-tablet-10", null, "google-play/tablet-10", 1440, 2560],
    ],
  );
});

it("seeds a playful multi-environment project spectrum", () => {
  assert.deepStrictEqual(
    SHOWCASE_PROJECTS.map((project) => project.title),
    ["supaterm", "tidepool", "lattice"],
  );
  assert.deepStrictEqual(
    SHOWCASE_ENVIRONMENTS.map((environment) => environment.label),
    ["Studio Laptop", "Basement Tower", "Helsinki VPS"],
  );
  assert.equal(SHOWCASE_THREADS.length, 9);
  assert.equal(new Set(SHOWCASE_THREADS.map((thread) => thread.projectId)).size, 3);
  const snoozedThreads = SHOWCASE_THREADS.filter((thread) => "snoozeMinutes" in thread);
  assert.equal(snoozedThreads.length, 2);
  assert.deepStrictEqual(
    snoozedThreads.map((thread) => thread.id),
    ["forecast-units", "flaky-fsync"],
  );
  assert.equal(new Set(snoozedThreads.map((thread) => thread.snoozeMinutes)).size, 2);
  for (const thread of snoozedThreads) {
    assert.equal(thread.response !== null, true, `${thread.title} is not completed`);
    assert.equal("state" in thread, false, `${thread.title} is blocked or working`);
    assert.equal("done" in thread, false, `${thread.title} is done`);
    assert.equal(thread.snoozeMinutes > 60, true, `${thread.title} wakes too soon`);
  }
  const primaryThread = SHOWCASE_THREADS.find((thread) => thread.id === "offline-reason");
  assert.equal(primaryThread !== undefined && !("snoozeMinutes" in primaryThread), true);
  // Every project contributes to both the active block and the done tail,
  // so each list scope screenshots with the same two-part structure.
  for (const project of SHOWCASE_PROJECTS) {
    const projectThreads = SHOWCASE_THREADS.filter((thread) => thread.projectId === project.id);
    assert.equal(
      projectThreads.some((thread) => "done" in thread && thread.done),
      true,
      `${project.title} has no done thread`,
    );
    assert.equal(
      projectThreads.some((thread) => !("done" in thread && thread.done)),
      true,
      `${project.title} has no active thread`,
    );
  }
  assert.equal(
    SHOWCASE_PROJECTS.every((project) => project.favicon.includes("<svg")),
    true,
  );
});

it("reads multiline JSON from the pairing CLI", () => {
  assert.equal(
    parsePairingCredentialOutput('server log\n{\n  "credential": "PAIR-ME"\n}\n'),
    "PAIR-ME",
  );
});

it("encodes Android pairing URLs without shell-sensitive JSON quotes", () => {
  const urls = ["http://10.0.2.2:65164/#token=ONE", "http://10.0.2.2:65198/#token=TWO"];
  const encoded = encodeAndroidPairingUrls(urls);
  assert.equal(encoded.startsWith("json-uri:"), true);
  assert.deepStrictEqual(JSON.parse(decodeURIComponent(encoded.slice("json-uri:".length))), urls);
  assert.equal(encoded.includes('"'), false);
});
