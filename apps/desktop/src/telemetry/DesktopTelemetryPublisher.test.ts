import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronPowerMonitor from "../electron/ElectronPowerMonitor.ts";
import * as DesktopTelemetryPublisher from "./DesktopTelemetryPublisher.ts";
import * as DesktopShellEnvironment from "../shell/DesktopShellEnvironment.ts";

function layerElectronApp(
  metrics: ReadonlyArray<Electron.ProcessMetric>,
  onMetricsRead: () => void = () => undefined,
) {
  return Layer.succeed(ElectronApp.ElectronApp, {
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
    setName: () => Effect.void,
    setAboutPanelOptions: () => Effect.void,
    setAppUserModelId: () => Effect.void,
    getAppMetrics: Effect.sync(() => {
      onMetricsRead();
      return metrics;
    }),
    setAsDefaultProtocolClient: () => Effect.succeed(true),
    setDesktopName: () => Effect.void,
    setDockIcon: () => Effect.void,
    appendCommandLineSwitch: () => Effect.void,
    removeCommandLineSwitch: () => Effect.void,
    onBeforeQuitForUpdate: () => Effect.void,
    on: () => Effect.void,
  } satisfies ElectronApp.ElectronApp["Service"]);
}

describe("DesktopTelemetryPublisher", () => {
  it.effect(
    "forwards shell discovery while a telemetry sample is pending and stops on scope close",
    () =>
      Effect.gen(function* () {
        const pollStarted = yield* Deferred.make<void>();
        const blockPoll = yield* Deferred.make<void>();
        const layerPower = Layer.succeed(
          ElectronPowerMonitor.ElectronPowerMonitor,
          ElectronPowerMonitor.ElectronPowerMonitor.of({
            isOnBatteryPower: Effect.succeed(false),
            getSystemIdleTime: Deferred.succeed(pollStarted, undefined).pipe(
              Effect.andThen(Deferred.await(blockPoll)),
              Effect.as(0),
            ),
            getSystemIdleState: () => Effect.succeed("active"),
            getCurrentThermalState: Effect.succeed("nominal"),
            onSimpleEvent: () => Effect.void,
            onThermalStateChange: () => Effect.void,
            onSpeedLimitChange: () => Effect.void,
          }),
        );
        const layer = DesktopTelemetryPublisher.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              layerElectronApp([]),
              layerPower,
              Layer.succeed(DesktopShellEnvironment.DesktopShellEnvironment, {
                installIntoProcess: Effect.succeed(true),
                awaitDiscovery: Effect.succeed(true),
                updates: Stream.make({
                  version: 1,
                  type: "shellEnvironment",
                  discovered: true,
                  platform: "darwin",
                  environment: { PATH: "/discovered/bin" },
                }),
              }),
            ),
          ),
        );
        const scope = yield* Scope.make();

        const context = yield* Layer.buildWithScope(layer, scope);
        const publisher = Context.get(context, DesktopTelemetryPublisher.DesktopTelemetryPublisher);
        const update = yield* publisher.encoded.pipe(
          Stream.filter((bytes) => new TextDecoder().decode(bytes).includes("shellEnvironment")),
          Stream.runHead,
        );
        assert.isTrue(Option.isSome(update));
        if (Option.isSome(update))
          assert.include(new TextDecoder().decode(update.value), "/discovered/bin");
        yield* Deferred.await(pollStarted);

        const closeFiber = yield* Scope.close(scope, Exit.void).pipe(Effect.forkDetach);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        assert.isDefined(closeFiber.pollUnsafe());
      }),
  );
});
