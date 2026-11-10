import "vite-plus/test/config";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- tsdown needs the asset path when it reads this config.
import * as NodePath from "node:path";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";
import { SEA_NODE_VERSION } from "./scripts/seaNodeVersion.ts";
import { WeightedShardSequencer } from "./src/testUtils/weightedShardSequencer.ts";

// NSIS install time tracks file count, not bytes.
import {
  isExternalCliDependency,
  shouldBundleCliDependency,
} from "../../scripts/lib/cli-external-packages.ts";

export { shouldBundleCliDependency };

const TELEMETRY_CHANNELS = ["stable", "nightly", "preview", "dev"];
const telemetryChannel = process.env.SUPATERM_TELEMETRY_CHANNEL?.trim() || "dev";
if (!TELEMETRY_CHANNELS.includes(telemetryChannel)) {
  throw new Error(
    `SUPATERM_TELEMETRY_CHANNEL must be one of ${TELEMETRY_CHANNELS.join(", ")}, got "${telemetryChannel}".`,
  );
}

// tsdown's exe step refuses multi-chunk output (sourcemaps count), so build:exe packs separately.
// "bundle" emits the embedded CLI. "1" builds dist-exe/supaterm from the bootstrap.
// TEMPORARY one-time Node fix. Remove when fixed: https://github.com/nodejs/node/issues/67048
// "bootstrap" stops at bin.mjs for scripts/cli.ts to inject (linux-arm64).
const packMode = process.env.SUPATERM_PACK_EXE;
const packBootstrap = packMode === "1" || packMode === "bootstrap";
const packExecutable = packBootstrap || packMode === "bundle";
const cliAssetDir = process.env.SUPATERM_CLI_ASSET_DIR ?? "";
if (packExecutable && !cliAssetDir) throw new Error("Build the executable with build:exe.");
// TEMPORARY one-time Node fix. Remove when fixed: https://github.com/nodejs/node/issues/67048
// No linux-arm64: --build-sea output cannot load on 16/64 KiB page kernels, so it builds natively.
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

// The root config's `projects` route repo-root runs to package configs,
// including this one. Inheriting them would make this config a container.
const { projects: _rootTestProjects, ...baseTestConfig } = baseConfig.test ?? {};
// Workspace cache configuration is invalid on a package config.
const { run: _rootRunConfig, ...basePackageConfig } = baseConfig;

export default mergeConfig(
  { ...basePackageConfig, test: baseTestConfig },
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
      // The executable embeds the bootstrap and the CLI as an asset; the history worker becomes
      // a hidden subcommand there instead of a sibling script.
      entry: packBootstrap
        ? ["src/bin.ts"]
        : packExecutable
          ? ["src/binMain.ts"]
          : ["src/bin.ts", "src/claude-history-worker.ts"],
      outDir: packBootstrap ? "dist-exe" : packExecutable ? cliAssetDir : "dist",
      sourcemap: !packExecutable,
      clean: true,
      // SEA can only resolve built-ins; keep dynamic imports inside each emitted module.
      ...(packExecutable ? { outputOptions: { codeSplitting: false } } : {}),
      ...(packMode === "1"
        ? {
            exe: {
              fileName: "supaterm",
              outDir: "dist-exe",
              ...(packExecutableTargets ? { targets: packExecutableTargets } : {}),
              // Node's SEA docs: `import()` does not work when useCodeCache is
              // true, and the server reaches several modules that way.
              seaConfig: {
                useCodeCache: false,
                // The bootstrap loads the embedded CLI with require(esm).
                execArgv: ["--require-module"],
                assets: { "binMain.mjs": NodePath.join(cliAssetDir, "binMain.mjs") },
              },
            },
          }
        : {}),
      deps: {
        // `neverBundle` forces the native packages out: returning false from
        // `alwaysBundle` only means "no opinion", so a transitive dependency
        // would still be bundled — which silently inlined native loaders such
        // as node-gyp-build, losing native acceleration.
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
      // The server suite exercises sqlite, git, temp worktrees, and orchestration
      // runtimes heavily. Running files in parallel introduces load-sensitive flakes.
      fileParallelism: false,
      sequence: { sequencer: WeightedShardSequencer },
      // Appended to the root setup, which mergeConfig concatenates.
      setupFiles: [
        "./src/testUtils/gitConfig.setup.ts",
        "./src/testUtils/managedServiceEnv.setup.ts",
      ],
      hookTimeout: 120_000,
      testTimeout: 120_000,
    },
  }),
);
