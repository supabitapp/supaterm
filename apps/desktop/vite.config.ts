import "vite-plus/test/config";
import * as NodeOS from "node:os";

import { defaultInclude, defineConfig } from "vite-plus";

import { isDesktopRuntimeExternalDependency } from "../../scripts/lib/desktop-external-packages.ts";

const domTests = ["src/preview/PickPreload.test.ts"];

// The packaged app then installs just those externals, instead of a full
// production install of apps/desktop's dependency tree next to a server bundle
// that already carries its own copy of the same libraries.
const isMainProcessExternal = (id: string) =>
  id === "electron" || id.startsWith("electron/") || isDesktopRuntimeExternalDependency(id);
const shouldLaunchElectronAfterPack = process.env.SUPATERM_DESKTOP_DEV === "1";
// tsdown runs onSuccess through a shell. dash forks instead of exec'ing the last command, which
// would leave an `sh` between `vp pack` and the supervisor and hide `vp pack` dying from it.
const devElectronCommand =
  // oxlint-disable-next-line supaterm/no-global-process-runtime -- Build config has no Effect runtime.
  NodeOS.platform() === "win32"
    ? "node scripts/dev-electron.mjs"
    : "exec node scripts/dev-electron.mjs";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command:
          "node scripts/build-browser-secret.mjs && node scripts/build-sd-eject-guard.mjs && node scripts/build-preview-annotation-css.mjs && vp pack",
        dependsOn: ["supaterm#build"],
        cache: false,
      },
      // CI bundle jobs skip the Linux browser secret helper; packaging stages one per arch.
      "build:bundle": {
        command: "node scripts/build-preview-annotation-css.mjs && vp pack",
        dependsOn: ["supaterm#build"],
        cache: false,
      },
      dev: {
        command:
          "node scripts/build-browser-secret.mjs && node scripts/build-sd-eject-guard.mjs && node scripts/build-preview-annotation-css.mjs && cross-env SUPATERM_DESKTOP_DEV=1 vp pack --watch",
        dependsOn: ["supaterm#build"],
        cache: false,
      },
      "dev:bundle": {
        command:
          "node scripts/build-browser-secret.mjs && node scripts/build-sd-eject-guard.mjs && node scripts/build-preview-annotation-css.mjs && vp pack --watch",
        cache: false,
      },
      "dev:electron": {
        command: "node scripts/dev-electron.mjs",
        dependsOn: ["supaterm#build"],
        cache: false,
      },
      // tsc (tsc-rs) rewrites the tsbuildinfo it reads, which keeps a task out of the cache.
      typecheck: {
        command: "tsc --noEmit",
        cache: { input: [{ auto: true }, "!*.tsbuildinfo"] },
      },
    },
  },
  pack: [
    {
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      outputOptions: { codeSplitting: false },
      entry: ["src/main.ts"],
      clean: true,
      deps: {
        alwaysBundle: (id) => !id.startsWith("node:") && !isMainProcessExternal(id),
        neverBundle: isMainProcessExternal,
        onlyBundle: false,
      },
      ...(shouldLaunchElectronAfterPack ? { onSuccess: devElectronCommand } : {}),
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: [
        "src/electron/WindowsForegroundFocusWorker.ts",
        "src/snapShot/GlobalShiftShortcutWorker.ts",
        "src/snapShot/RegionSnapShotWorker.ts",
        "src/snapShot/SnapShotAccessibilityWorker.ts",
      ],
      clean: false,
      deps: {
        alwaysBundle: (id) => !id.startsWith("node:") && !isMainProcessExternal(id),
        neverBundle: isMainProcessExternal,
        onlyBundle: false,
      },
    },
    {
      // boot.cjs requires the other two at runtime, so all three stay separate files.
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/boot.ts", "src/compileCache.ts", "src/serverCompileCache.ts"],
      clean: false,
      deps: {
        neverBundle: (id) => id === "./main.cjs" || id === "./compileCache.cjs",
      },
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preload.ts"],
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preview-pick-preload.ts"],
      deps: {
        alwaysBundle: (id) => id === "react-grab" || id.startsWith("react-grab/"),
      },
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preview-pip-preload.ts"],
    },
    {
      // Sandboxed preloads must be self-contained, without shared runtime chunks.
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/mac-permission-preload.ts"],
    },
  ],
  test: {
    // The Windows lane runs workspace suites concurrently; filesystem-heavy
    // desktop integration tests can exceed Vitest's 5 second default there.
    testTimeout: 15_000,
    // `require("electron")` downloads a missing binary, so concurrent workers race to
    // extract it into the same dist/. Install it once before any worker starts.
    globalSetup: ["./scripts/ensure-electron-runtime.mjs"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [...defaultInclude, "../../native/kde-snap-shot/src/*.test.ts"],
          exclude: ["**/node_modules/**", ...domTests],
          setupFiles: [
            "../../packages/shared/src/testing/longTempDir.ts",
            "../../packages/shared/src/testing/providerEnv.ts",
            "../../packages/shared/src/testing/gitEnv.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          include: domTests,
          // Guest preloads run in the page; these tests drive them against a DOM.
          environment: "jsdom",
          setupFiles: [
            "../../packages/shared/src/testing/providerEnv.ts",
            "../../packages/shared/src/testing/gitEnv.ts",
          ],
        },
      },
    ],
  },
});
