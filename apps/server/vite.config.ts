import "vite-plus/test/config";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- tsdown needs the asset path when it reads this config.
import * as NodePath from "node:path";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";
import { SEA_NODE_VERSION } from "./scripts/seaNodeVersion.ts";
import { resolveTaggedSourceVersion } from "../../scripts/lib/tagged-source-version.ts";
import packageJson from "./package.json" with { type: "json" };
import { WeightedShardSequencer } from "./src/testUtils/weightedShardSequencer.ts";

import {
  isExternalCliDependency,
  shouldBundleCliDependency,
} from "../../scripts/lib/cli-external-packages.ts";

export { shouldBundleCliDependency };

const serverManifestPath = NodePath.join(import.meta.dirname, "package.json");
const buildVersion =
  process.env.APP_VERSION?.trim() ||
  resolveTaggedSourceVersion(NodePath.join(import.meta.dirname, "../.."), packageJson.version);
const TELEMETRY_CHANNELS = ["stable", "nightly", "preview", "dev"];
const telemetryChannel = process.env.SUPATERM_TELEMETRY_CHANNEL?.trim() || "dev";
if (!TELEMETRY_CHANNELS.includes(telemetryChannel)) {
  throw new Error(
    `SUPATERM_TELEMETRY_CHANNEL must be one of ${TELEMETRY_CHANNELS.join(", ")}, got "${telemetryChannel}".`,
  );
}

const packMode = process.env.SUPATERM_PACK_EXE;
const packBootstrap = packMode === "1" || packMode === "bootstrap";
const packExecutable = packBootstrap || packMode === "bundle";
const cliAssetDir = process.env.SUPATERM_CLI_ASSET_DIR ?? "";
if (packExecutable && !cliAssetDir) throw new Error("Build the executable with build:exe.");
const SEA_TARGETS = {
  "darwin-arm64": { platform: "darwin", arch: "arm64" },
  "darwin-x64": { platform: "darwin", arch: "x64" },
  "linux-x64": { platform: "linux", arch: "x64" },
  "win-arm64": { platform: "win", arch: "arm64" },
  "win-x64": { platform: "win", arch: "x64" },
} as const;
const packExecutableTarget = process.env.SUPATERM_PACK_EXE_TARGET?.trim();
if (packExecutable && !packExecutableTarget && process.versions.node !== SEA_NODE_VERSION) {
  throw new Error(
    `Native CLI executables must be built with Node ${SEA_NODE_VERSION}; running ${process.versions.node}.`,
  );
}
if (packExecutableTarget && !Object.hasOwn(SEA_TARGETS, packExecutableTarget)) {
  throw new Error(
    `SUPATERM_PACK_EXE_TARGET must be one of ${Object.keys(SEA_TARGETS).join(", ")}, got "${packExecutableTarget}".`,
  );
}
const packExecutableTargets = packExecutableTarget
  ? [
      {
        ...SEA_TARGETS[packExecutableTarget as keyof typeof SEA_TARGETS],
        nodeVersion: SEA_NODE_VERSION,
      },
    ]
  : undefined;

const { projects: _rootTestProjects, ...baseTestConfig } = baseConfig.test ?? {};

export default mergeConfig(
  { ...baseConfig, test: baseTestConfig },
  defineConfig({
    run: {
      tasks: {
        build: {
          command: "node scripts/cli.ts build",
          dependsOn: ["@supaterm/web#build"],
          cache: false,
        },
      },
    },
    pack: {
      plugins: [
        {
          name: "supaterm:build-version",
          load(id) {
            if (NodePath.resolve(id) !== serverManifestPath) return;
            return {
              code: JSON.stringify({ ...packageJson, version: buildVersion }),
              moduleType: "json",
            };
          },
        },
      ],
      entry: packBootstrap
        ? ["src/bin.ts"]
        : packExecutable
          ? ["src/binMain.ts"]
          : ["src/bin.ts", "src/claude-history-worker.ts"],
      outDir: packBootstrap ? "dist-exe" : packExecutable ? cliAssetDir : "dist",
      sourcemap: !packExecutable,
      clean: true,
      ...(packExecutable ? { outputOptions: { codeSplitting: false } } : {}),
      ...(packMode === "1"
        ? {
            exe: {
              fileName: "supaterm",
              outDir: "dist-exe",
              ...(packExecutableTargets ? { targets: packExecutableTargets } : {}),
              seaConfig: {
                useCodeCache: false,
                execArgv: ["--require-module"],
                assets: { "binMain.mjs": NodePath.join(cliAssetDir, "binMain.mjs") },
              },
            },
          }
        : {}),
      alias: { "jsonc-parser": "jsonc-parser/lib/esm/main.js" },
      deps: {
        alwaysBundle: shouldBundleCliDependency,
        neverBundle: (id: string) =>
          (packBootstrap && id === "./binMain.ts") || isExternalCliDependency(id),
        onlyBundle: false,
      },
      banner: {
        js: "#!/usr/bin/env node\n",
      },
      define: {
        __SUPATERM_TELEMETRY_CHANNEL__: JSON.stringify(telemetryChannel),
      },
    },
    test: {
      fileParallelism: false,
      sequence: { sequencer: WeightedShardSequencer },
      setupFiles: [
        "./src/testUtils/gitConfig.setup.ts",
        "./src/testUtils/managedServiceEnv.setup.ts",
      ],
      hookTimeout: 120_000,
      testTimeout: 120_000,
    },
  }),
);
