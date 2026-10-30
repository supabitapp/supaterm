import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { beforeEach, vi } from "vite-plus/test";

const {
  appendSwitchMock,
  getSwitchValueMock,
  hasSwitchMock,
  registerSchemesMock,
  setDesktopNameMock,
  mkdirSyncMock,
  writeFileSyncMock,
  copyFileSyncMock,
  execFileSyncMock,
  readFileSyncMock,
} = vi.hoisted(() => ({
  appendSwitchMock: vi.fn(),
  getSwitchValueMock: vi.fn(),
  hasSwitchMock: vi.fn(),
  registerSchemesMock: vi.fn(),
  setDesktopNameMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  copyFileSyncMock: vi.fn(),
  execFileSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    setDesktopName: setDesktopNameMock,
    getVersion: () => "0.0.37",
    isPackaged: true,
    getAppPath: () => "/tmp/.mount_Supaterm/resources/app.asar",
    on: vi.fn(),
    removeListener: vi.fn(),
    commandLine: {
      appendSwitch: appendSwitchMock,
      getSwitchValue: getSwitchValueMock,
      hasSwitch: hasSwitchMock,
    },
  },
  protocol: {
    registerSchemesAsPrivileged: registerSchemesMock,
  },
}));

vi.mock("node:fs", () => ({
  existsSync: () => false,
  readFileSync: readFileSyncMock,
  mkdirSync: mkdirSyncMock,
  writeFileSync: writeFileSyncMock,
  copyFileSync: copyFileSyncMock,
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

import * as DesktopPreReadyPlatform from "./DesktopPreReadyPlatform.ts";

describe("DesktopPreReadyPlatform", () => {
  beforeEach(() => {
    appendSwitchMock.mockReset();
    getSwitchValueMock.mockReset();
    hasSwitchMock.mockReset();
    registerSchemesMock.mockReset();
    setDesktopNameMock.mockReset();
    mkdirSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    copyFileSyncMock.mockReset();
    execFileSyncMock.mockReset();
    readFileSyncMock.mockReset().mockReturnValue("{}");
  });

  it.effect("persists Linux scaling synchronously across relaunches and settings rewrites", () => {
    vi.stubEnv("SUPATERM_HOME", "/isolated");
    vi.stubEnv("VITE_DEV_SERVER_URL", "");
    const settingsPath = "/isolated/userdata/desktop-settings.json";
    const files = new Map([[settingsPath, "{}"]]);
    const commandLine = new Map<string, string>();
    readFileSyncMock.mockImplementation((path: string) => {
      const contents = files.get(path);
      if (contents === undefined) throw new Error("ENOENT");
      return contents;
    });
    writeFileSyncMock.mockImplementation((path: string, contents: string) => {
      files.set(path, contents);
    });
    hasSwitchMock.mockImplementation((name: string) => commandLine.has(name));
    getSwitchValueMock.mockImplementation((name: string) => commandLine.get(name) ?? "");
    appendSwitchMock.mockImplementation((name: string, value: string) => {
      commandLine.set(name, value);
    });
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
    getSwitchValueMock.mockReturnValue("");
    let desktopName = "supaterm.desktop";
    let desktopEntry = previousEntry;
    let iconInstalled = false;
    copyFileSyncMock.mockImplementation((_source: string, destination: string) => {
      iconInstalled = destination === "/xdg/icons/com.supaterm.desktop.desktop.png";
    });
    setDesktopNameMock.mockImplementation((name: string) => {
      desktopName = name;
    });
    writeFileSyncMock.mockImplementation((path: string, contents: string) => {
      if (path === "/xdg/applications/com.supaterm.desktop.desktop") desktopEntry = contents;
    });

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
        assert.isTrue(identity.iconInstalled);
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())));
  });

  it.effect("points the early portal entry at a configured distribution launcher", () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "");
    vi.stubEnv("XDG_DATA_HOME", "/xdg");
    vi.stubEnv("APPIMAGE", "/Applications/current.AppImage");
    vi.stubEnv("SUPATERM_DESKTOP_LAUNCHER_PATH", " /opt/Supaterm/supaterm ");
    getSwitchValueMock.mockReturnValue("");

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
        assert.include(entry, 'Exec="/opt/Supaterm/supaterm" %U');
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
        registerSchemesMock.mockImplementation(() => {
          events.push("pre-ready");
        });

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
