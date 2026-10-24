import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const defaultEnvironmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/Applications/Supaterm.app/Contents/Resources/app.asar",
  isPackaged: true,
  resourcesPath: "/Applications/Supaterm.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

type TestEnvironmentInput = Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> & {
  readonly env?: Record<string, string | undefined>;
};

interface ElectronAppCalls {
  readonly setAboutPanelOptions: Array<Electron.AboutPanelOptionsOptions>;
  readonly setDockIcon: string[];
  readonly setName: string[];
}

const layerElectronApp = (calls: ElectronAppCalls) =>
  Layer.succeed(ElectronApp.ElectronApp, {
    metadata: Effect.die("unexpected metadata read"),
    name: Effect.succeed("Supaterm"),
    systemLocale: Effect.succeed("en-US"),
    environmentMachineIcons: Effect.succeed({}),
    whenReady: Effect.void,
    requestSingleInstanceLock: Effect.succeed(true),
    quit: Effect.void,
    exit: () => Effect.void,
    relaunch: () => Effect.void,
    setPath: () => Effect.void,
    setName: (name) =>
      Effect.sync(() => {
        calls.setName.push(name);
      }),
    setAboutPanelOptions: (options) =>
      Effect.sync(() => {
        calls.setAboutPanelOptions.push(options);
      }),
    setAppUserModelId: () => Effect.void,
    getAppMetrics: Effect.succeed([]),
    setAsDefaultProtocolClient: () => Effect.succeed(true),
    setDesktopName: () => Effect.void,
    setDockIcon: (iconPath) =>
      Effect.sync(() => {
        calls.setDockIcon.push(iconPath);
      }),
    appendCommandLineSwitch: () => Effect.void,
    onBeforeQuitForUpdate: () => Effect.void,
    removeCommandLineSwitch: () => Effect.void,
    on: () => Effect.void,
  } satisfies ElectronApp.ElectronApp["Service"]);

const layerAssets = (png: Option.Option<string>) =>
  Layer.succeed(DesktopAssets.DesktopAssets, {
    iconPaths: Effect.succeed({
      ico: Option.none(),
      icns: Option.none(),
      png,
    }),
    resolveResourcePath: () => Effect.succeedNone,
  } satisfies DesktopAssets.DesktopAssets["Service"]);

const layerEnvironment = (overrides: TestEnvironmentInput = {}) => {
  const { env, ...environmentOverrides } = overrides;
  return DesktopEnvironment.layer({
    ...defaultEnvironmentInput,
    ...environmentOverrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        NodePath.layerPosix,
        DesktopConfig.layerTest({
          ...env,
        }),
      ),
    ),
  );
};

const withIdentity = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    | R
    | DesktopAppIdentity.DesktopAppIdentity
    | DesktopEnvironment.DesktopEnvironment
    | FileSystem.FileSystem
  >,
  input: {
    readonly calls?: ElectronAppCalls;
    readonly environment?: TestEnvironmentInput;
    readonly packageJson?: string;
    readonly pngIconPath?: Option.Option<string>;
  } = {},
) => {
  const calls: ElectronAppCalls = input.calls ?? {
    setAboutPanelOptions: [],
    setDockIcon: [],
    setName: [],
  };

  return effect.pipe(
    Effect.provide(
      DesktopAppIdentity.layer.pipe(
        Layer.provide(NodePath.layerPosix),
        Layer.provideMerge(
          FileSystem.layerNoop({
            readFileString: () =>
              Effect.succeed(input.packageJson ?? '{"supatermCommitHash":"abcdef1234567890"}'),
          }),
        ),
        Layer.provideMerge(layerAssets(input.pngIconPath ?? Option.none())),
        Layer.provideMerge(layerElectronApp(calls)),
        Layer.provideMerge(layerEnvironment(input.environment)),
      ),
    ),
  );
};

describe("DesktopAppIdentity", () => {
  it.effect.each([
    { stage: "Stable", runtimeName: "Supaterm", aboutName: "Supaterm", environment: {} },
    {
      stage: "Nightly",
      runtimeName: "Supaterm Nightly",
      aboutName: "Supaterm",
      environment: { appVersion: "0.0.43-nightly.20260929.2428" },
    },
    {
      stage: "Dev",
      runtimeName: "Supaterm Dev",
      aboutName: "Supaterm",
      environment: { env: { VITE_DEV_SERVER_URL: "http://localhost:5173" } },
    },
  ])(
    "uses a valid native User-Agent product name for $stage",
    ({ runtimeName: expectedName, aboutName, environment }) => {
      const calls: ElectronAppCalls = {
        setAboutPanelOptions: [],
        setDockIcon: [],
        setName: [],
      };

      return withIdentity(
        Effect.gen(function* () {
          const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
          yield* identity.configure;

          const runtimeName = calls.setName[0];
          assert.isDefined(runtimeName);
          assert.equal(runtimeName, expectedName);

          assert.match(runtimeName.replaceAll(" ", ""), /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/);
          assert.equal(calls.setAboutPanelOptions[0]?.applicationName, aboutName);
        }),
        { calls, environment },
      );
    },
  );

  it.effect("preserves the adaptive bundle icon when running unpackaged", () => {
    const calls: ElectronAppCalls = {
      setAboutPanelOptions: [],
      setDockIcon: [],
      setName: [],
    };

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        yield* identity.configure;

        assert.deepEqual(calls.setDockIcon, []);
      }),
      {
        calls,
        environment: { isPackaged: false },
        pngIconPath: Option.some("/icon.png"),
      },
    );
  });
});
