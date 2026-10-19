import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";
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

// `build:exe` wraps the same bundle in a Node single-executable. tsdown's exe
// step refuses multi-chunk output and counts the sourcemap as a chunk, and the
// executable needs a host Node that supports `--build-sea` (25.7+), so this is
// a separate mode rather than a second entry in the default build.
const packExecutable = process.env.SUPATERM_PACK_EXE === "1";
const SEA_NODE_VERSION = "26.8.2";
const SEA_TARGETS = {
  "darwin-arm64": { platform: "darwin", arch: "arm64" },
  "darwin-x64": { platform: "darwin", arch: "x64" },
  "linux-arm64": { platform: "linux", arch: "arm64" },
  "linux-x64": { platform: "linux", arch: "x64" },
  "win-arm64": { platform: "win", arch: "arm64" },
  "win-x64": { platform: "win", arch: "x64" },
} as const;
const packExecutableTarget = process.env.SUPATERM_PACK_EXE_TARGET?.trim();
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

export default mergeConfig(
  baseConfig,
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
      // The executable embeds one entry; the history worker becomes a hidden
      // subcommand there instead of a sibling script.
      entry: packExecutable ? ["src/bin.ts"] : ["src/bin.ts", "src/claude-history-worker.ts"],
      outDir: packExecutable ? "dist-exe" : "dist",
      sourcemap: !packExecutable,
      clean: true,
      ...(packExecutable
        ? {
            exe: {
              fileName: "supaterm",
              outDir: "dist-exe",
              ...(packExecutableTargets ? { targets: packExecutableTargets } : {}),
              // Node's SEA docs: `import()` does not work when useCodeCache is
              // true, and the server reaches several modules that way.
              seaConfig: { useCodeCache: false },
            },
          }
        : {}),
      deps: {
        // `neverBundle` forces the native packages out: returning false from
        // `alwaysBundle` only means "no opinion", so a transitive dependency
        // would still be bundled — which silently inlined native loaders such
        // as node-gyp-build, losing native acceleration.
        alwaysBundle: shouldBundleCliDependency,
        neverBundle: (id: string) => isExternalCliDependency(id),
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
      setupFiles: ["./src/testUtils/gitConfig.setup.ts"],
      hookTimeout: 120_000,
      testTimeout: 120_000,
    },
  }),
);
