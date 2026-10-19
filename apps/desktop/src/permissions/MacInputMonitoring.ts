import type { CodexMicroPermissionStatus } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as MacPermissions from "./MacPermissions.ts";

const IOKIT_PATH = "/System/Library/Frameworks/IOKit.framework/IOKit";
const LISTEN_EVENT_REQUEST = 1;
const ACCESS_GRANTED = 0;
const ACCESS_UNKNOWN = 2;

interface IOKitHidAccess {
  readonly check: () => number;
  readonly request: () => boolean;
}

export class MacInputMonitoring extends Context.Service<
  MacInputMonitoring,
  {
    readonly status: Effect.Effect<CodexMicroPermissionStatus>;
    /** Asks macOS to prompt once, which also adds the app to the Input Monitoring list. */
    readonly requestIfUndetermined: Effect.Effect<void>;
    readonly openSettings: Effect.Effect<void>;
  }
>()("@supaterm/desktop/permissions/MacInputMonitoring") {}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const shell = yield* ElectronShell.ElectronShell;
  const permissions = yield* MacPermissions.MacPermissions;
  let ioKit: Promise<IOKitHidAccess> | undefined;

  const loadIOKit = () =>
    (ioKit ??= import("ffi-rs").then(({ DataType, load, open }) => {
      const library = "supaterm-iokit";
      open({ library, path: IOKIT_PATH });
      return {
        check: () =>
          load({
            library,
            funcName: "IOHIDCheckAccess",
            retType: DataType.I32,
            paramsType: [DataType.I32],
            paramsValue: [LISTEN_EVENT_REQUEST],
          }),
        request: () =>
          load({
            library,
            funcName: "IOHIDRequestAccess",
            retType: DataType.Boolean,
            paramsType: [DataType.I32],
            paramsValue: [LISTEN_EVENT_REQUEST],
          }),
      };
    }));

  const access = Effect.tryPromise(() => loadIOKit().then((api) => api.check())).pipe(
    Effect.option,
  );

  const status = Effect.gen(function* () {
    if (environment.platform !== "darwin") return "unavailable" as const;
    // Until the user answers the prompt macOS reports "unknown" and treats access as not granted.
    return Option.match(yield* access, {
      onNone: () => "unavailable" as const,
      onSome: (value) => (value === ACCESS_GRANTED ? ("granted" as const) : ("denied" as const)),
    });
  }).pipe(Effect.withSpan("desktop.macInputMonitoring.status"));

  const requestIfUndetermined = Effect.gen(function* () {
    if (environment.platform !== "darwin") return;
    const result = yield* access;
    if (Option.isNone(result) || result.value !== ACCESS_UNKNOWN) return;
    yield* Effect.tryPromise(() => loadIOKit().then((api) => api.request())).pipe(Effect.ignore);
  }).pipe(Effect.withSpan("desktop.macInputMonitoring.requestIfUndetermined"));

  const openSettings = Effect.gen(function* () {
    if (environment.platform !== "darwin") return;
    const owner = Electron.BrowserWindow.getFocusedWindow();
    if (!(yield* shell.openSystemSettings("input-monitoring"))) return;
    yield* permissions.showHelper("input-monitoring", owner, () =>
      loadIOKit().then((api) => api.check() === ACCESS_GRANTED),
    );
  }).pipe(Effect.withSpan("desktop.macInputMonitoring.openSettings"));

  return MacInputMonitoring.of({ status, requestIfUndetermined, openSettings });
});

export const layer = Layer.effect(MacInputMonitoring, make);
