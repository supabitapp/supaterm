import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { beforeEach, vi } from "vite-plus/test";

const {
  appendSwitchMock,
  behavior,
  copyFileSyncMock,
  registerSchemesMock,
  resetBehavior,
  setDesktopNameMock,
  symlinkSyncMock,
  writeFileSyncMock,
} = vi.hoisted(() => {
  type Behavior = {
    readFileSync: (path: string) => string | Buffer;
    writeFileSync: (path: string, contents: string | Buffer) => void;
    hasSwitch: (name: string) => boolean;
    getSwitchValue: (name: string) => string | undefined;
    appendSwitch: (name: string, value: string) => void;
    setDesktopName: (name: string) => void;
    registerSchemes: () => void;
  };
  const defaults: Behavior = {
    readFileSync: () => "{}",
    writeFileSync: () => undefined,
    hasSwitch: () => false,
    getSwitchValue: () => undefined,
    appendSwitch: () => undefined,
    setDesktopName: () => undefined,
    registerSchemes: () => undefined,
  };
  const behavior: Behavior = { ...defaults };
  return {
    behavior,
    resetBehavior: () => Object.assign(behavior, defaults),
    appendSwitchMock: vi.fn(),
    registerSchemesMock: vi.fn(),
    setDesktopNameMock: vi.fn(),
    writeFileSyncMock: vi.fn(),
    copyFileSyncMock: vi.fn(),
    symlinkSyncMock: vi.fn(),
  };
});

vi.mock("electron", () => ({
  app: {
    setDesktopName: (name: string) => {
      setDesktopNameMock(name);
      behavior.setDesktopName(name);
    },
    getVersion: () => "0.0.37",
    isPackaged: true,
    getAppPath: () => "/tmp/.mount_Supaterm/resources/app.asar",
    on: () => undefined,
    removeListener: () => undefined,
    commandLine: {
      appendSwitch: (name: string, value: string) => {
        appendSwitchMock(name, value);
        behavior.appendSwitch(name, value);
      },
      getSwitchValue: (name: string) => behavior.getSwitchValue(name),
      hasSwitch: (name: string) => behavior.hasSwitch(name),
    },
  },
  protocol: {
    registerSchemesAsPrivileged: (...args: ReadonlyArray<unknown>) => {
      registerSchemesMock(...args);
      behavior.registerSchemes();
    },
  },
}));

vi.mock("node:fs", () => ({
  existsSync: () => false,
  readFileSync: (path: string) => behavior.readFileSync(path),
  mkdirSync: () => undefined,
  writeFileSync: (path: string, contents: string | Buffer) => {
    writeFileSyncMock(path, contents);
    behavior.writeFileSync(path, contents);
  },
  copyFileSync: copyFileSyncMock,
  symlinkSync: symlinkSyncMock,
}));

vi.mock("node:child_process", () => ({
  execFileSync: () => undefined,
}));

import * as DesktopPreReadyPlatform from "./DesktopPreReadyPlatform.ts";

describe("DesktopPreReadyPlatform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBehavior();
  });

  it.effect("persists Linux scaling synchronously across relaunches and settings rewrites", () => {
    vi.stubEnv("SUPATERM_HOME", "/isolated");
    vi.stubEnv("VITE_DEV_SERVER_URL", "");
    const settingsPath = "/isolated/userdata/desktop-settings.json";
    const files = new Map([[settingsPath, "{}"]]);
    const commandLine = new Map<string, string>();
    behavior.readFileSync = (path) => {
      const contents = files.get(path);
      if (contents === undefined) throw new Error("ENOENT");
      return contents;
    };
    behavior.writeFileSync = (path, contents) => {
      files.set(path, String(contents));
    };
    behavior.hasSwitch = (name) => commandLine.has(name);
    behavior.getSwitchValue = (name) => commandLine.get(name) ?? "";
    behavior.appendSwitch = (name, value) => {
      commandLine.set(name, value);
    };
    const launch = Effect.gen(function* () {
      const startup = Promise.resolve().then(() => commandLine.get("force-device-scale-factor"));
      yield* DesktopPreReadyPlatform.make;
      return yield* Effect.promise(() => startup);
    });

    return Effect.gen(function* () {
      for (const explicitScale of ["1.75", "1"]) {
        commandLine.clear();
        commandLine.set("force-device-scale-factor", explicitScale);
        appendSwitchMock.mockClear();
        assert.equal(yield* launch, explicitScale);
        assert.isFalse(
          appendSwitchMock.mock.calls.some(([name]) => name === "force-device-scale-factor"),
        );

        files.set(settingsPath, JSON.stringify({ linuxPasswordStore: "basic" }));
        commandLine.clear();
        assert.equal(yield* launch, explicitScale);
      }
    }).pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())),
    );
  });

  it.effect.each([
    { previousEntry: undefined, label: "missing" },
    { previousEntry: 'Exec="/Applications/deleted-previous.AppImage" %U', label: "stale" },
  ])("prepares a $label Linux desktop entry before startup yields", ({ previousEntry }) => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "");
    vi.stubEnv("XDG_DATA_HOME", "/xdg");
    vi.stubEnv("APPIMAGE", "/Applications/current.AppImage");
    behavior.getSwitchValue = () => "";
    let desktopName = "supaterm.desktop";
    let desktopEntry = previousEntry;
    let iconInstalled = false;
    const iconSource =
      "/tmp/.mount_Supaterm/resources/app.asar/apps/desktop/prod-resources/icon.png";
    const iconPath = "/xdg/icons/com.supaterm.desktop.desktop.png";
    const iconBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    behavior.readFileSync = (path) => {
      if (path === iconSource) return iconBytes;
      return "{}";
    };
    behavior.setDesktopName = (name) => {
      desktopName = name;
    };
    behavior.writeFileSync = (path, contents) => {
      if (path === "/xdg/applications/com.supaterm.desktop.desktop")
        desktopEntry = String(contents);
      if (path === iconPath) iconInstalled = Buffer.compare(Buffer.from(contents), iconBytes) === 0;
    };

    return Effect.scoped(
      Effect.gen(function* () {
        const portalIdentity = Promise.resolve().then(() => ({
          desktopName,
          desktopEntry,
          iconInstalled,
        }));
        yield* Layer.build(
          DesktopPreReadyPlatform.layer.pipe(
            Layer.provide(Layer.succeed(HostProcess.Platform, "linux")),
          ),
        );
        const identity = yield* Effect.promise(() => portalIdentity);
        assert.equal(identity.desktopName, "com.supaterm.desktop.desktop");
        assert.include(identity.desktopEntry ?? "", "Exec=/Applications/current.AppImage %U");
        assert.include(identity.desktopEntry ?? "", "Name=Supaterm\n");
        assert.include(identity.desktopEntry ?? "", "MimeType=x-scheme-handler/supaterm;");
        assert.include(
          identity.desktopEntry ?? "",
          "Icon=/xdg/icons/com.supaterm.desktop.desktop.png",
        );
        assert.equal(
          copyFileSyncMock.mock.calls.length,
          0,
          "icon must not be copied out of the app bundle",
        );
        assert.isTrue(identity.iconInstalled, "icon must be written from the bundled bytes");
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())));
  });

  it.effect.each([
    { relaunchedByUpdater: "true", restored: true },
    { relaunchedByUpdater: "", restored: false },
  ])(
    "restores the versioned AppImage path an update removed (updater relaunch: $relaunchedByUpdater)",
    ({ relaunchedByUpdater, restored }) => {
      vi.stubEnv("VITE_DEV_SERVER_URL", "");
      vi.stubEnv("XDG_DATA_HOME", "/xdg");
      vi.stubEnv("APPIMAGE", "/Applications/supaterm-x86_64.AppImage");
      vi.stubEnv("APPIMAGE_SILENT_INSTALL", relaunchedByUpdater);
      behavior.getSwitchValue = () => "";
      const entryPath = "/xdg/applications/com.supaterm.desktop.desktop";
      const files = new Map([
        [entryPath, "Exec=/Applications/supaterm-0.1.8-x86_64.AppImage %U\n"],
      ]);
      behavior.readFileSync = (path) => files.get(path) ?? "{}";
      behavior.writeFileSync = (path, contents) => {
        files.set(path, String(contents));
      };

      return Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(
            DesktopPreReadyPlatform.layer.pipe(
              Layer.provide(Layer.succeed(HostProcess.Platform, "linux")),
            ),
          );
          assert.deepEqual(
            symlinkSyncMock.mock.calls,
            restored
              ? [["supaterm-x86_64.AppImage", "/Applications/supaterm-0.1.8-x86_64.AppImage"]]
              : [],
          );
          assert.include(files.get(entryPath), "Exec=/Applications/supaterm-x86_64.AppImage %U");
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())));
    },
  );

  it.effect("points the early portal entry at a configured distribution launcher", () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "");
    vi.stubEnv("XDG_DATA_HOME", "/xdg");
    vi.stubEnv("APPIMAGE", "/Applications/current.AppImage");
    vi.stubEnv("SUPATERM_DESKTOP_LAUNCHER_PATH", " /opt/Supaterm/supaterm ");
    behavior.getSwitchValue = () => "";

    return Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(
          DesktopPreReadyPlatform.layer.pipe(
            Layer.provide(Layer.succeed(HostProcess.Platform, "linux")),
          ),
        );
        const entry = writeFileSyncMock.mock.calls.find(
          ([path]) => path === "/xdg/applications/com.supaterm.desktop.desktop",
        )?.[1];
        assert.include(entry, "Exec=/opt/Supaterm/supaterm %U");
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())));
  });

  it.effect(
    "acquires a synchronous pre-ready layer before an asynchronous deep-link-shaped layer",
    () =>
      Effect.gen(function* () {
        class DeepLinkShaped extends Context.Service<DeepLinkShaped, { readonly ready: true }>()(
          "@supaterm/desktop/app/DesktopPreReadyPlatform.test/DeepLinkShaped",
        ) {}

        const events: Array<string> = [];
        behavior.registerSchemes = () => {
          events.push("pre-ready");
        };

        const layerPreReady = DesktopPreReadyPlatform.layer.pipe(
          Layer.provide(Layer.succeed(HostProcess.Platform, "darwin")),
        );

        const deepLinkShapedLayer = Layer.effect(
          DeepLinkShaped,
          Effect.promise(() => Promise.resolve()).pipe(
            Effect.map(() => {
              events.push("deep-links");
              return { ready: true as const };
            }),
          ),
        );

        const layerRuntime = deepLinkShapedLayer.pipe(
          Layer.flatMap((deepLinksContext) => Layer.succeedContext(deepLinksContext)),
          Layer.provideMerge(layerPreReady),
        );

        const result = yield* Effect.all({
          deepLinks: DeepLinkShaped,
          preReady: DesktopPreReadyPlatform.DesktopPreReadyElectronOptions,
        }).pipe(Effect.provide(layerRuntime));

        assert.deepEqual(result, {
          deepLinks: { ready: true },
          preReady: {
            linux: null,
            linuxPasswordStoreCommandLine: null,
          },
        });
        assert.deepEqual(events, ["pre-ready", "deep-links"]);
        assert.equal(registerSchemesMock.mock.calls.length, 1);
        assert.equal(appendSwitchMock.mock.calls.length, 0);
        assert.equal(setDesktopNameMock.mock.calls.length, 0);
      }),
  );
});
