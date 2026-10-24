import { DesktopHostTelemetryMessage } from "@supaterm/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronPowerMonitor from "../electron/ElectronPowerMonitor.ts";
import * as DesktopTelemetryPublisher from "./DesktopTelemetryPublisher.ts";

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
  it.effect("stops when its scope closes during an Electron telemetry sample", () =>
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
        Layer.provide(Layer.mergeAll(layerElectronApp([]), layerPower)),
      );
      const scope = yield* Scope.make();

      yield* Layer.buildWithScope(layer, scope);
      yield* Deferred.await(pollStarted);

      const closeFiber = yield* Scope.close(scope, Exit.void).pipe(Effect.forkDetach);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      assert.isDefined(closeFiber.pollUnsafe());
    }),
  );

  it.effect("routes requestDesktopUpdate control messages and replays update reports", () =>
    Effect.gen(function* () {
      const layerPower = Layer.succeed(
        ElectronPowerMonitor.ElectronPowerMonitor,
        ElectronPowerMonitor.ElectronPowerMonitor.of({
          isOnBatteryPower: Effect.succeed(false),
          getSystemIdleTime: Effect.succeed(0),
          getSystemIdleState: () => Effect.succeed("active"),
          getCurrentThermalState: Effect.succeed("nominal"),
          onSimpleEvent: () => Effect.void,
          onThermalStateChange: () => Effect.void,
          onSpeedLimitChange: () => Effect.void,
        }),
      );
      const layer = DesktopTelemetryPublisher.layer.pipe(
        Layer.provide(Layer.mergeAll(layerElectronApp([]), layerPower)),
      );

      yield* Effect.gen(function* () {
        const publisher = yield* DesktopTelemetryPublisher.DesktopTelemetryPublisher;

        const requestFiber = yield* Stream.runHead(publisher.updateRequests).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* publisher.handleControlForSource("test", {
          version: 1,
          type: "requestDesktopUpdate",
          requestId: "req-9",
        });
        const received = yield* Fiber.join(requestFiber);
        assert.equal(Option.getOrThrow(received).requestId, "req-9");

        const report = {
          version: 1,
          type: "desktopUpdateStatus",
          outcome: "up-to-date",
          state: {
            enabled: true,
            status: "up-to-date",
            channel: "latest",
            currentVersion: "1.2.3",
            hostArch: "arm64",
            appArch: "arm64",
            runningUnderArm64Translation: false,
            availableVersion: null,
            downloadedVersion: null,
            releaseNotes: [],
            downloadPercent: null,
            checkedAt: null,
            message: null,
            errorContext: null,
            canRetry: false,
            omittedReleaseCount: 0,
          },
        } as const;
        yield* publisher.publishUpdateReport(report);

        const decoder = new TextDecoder();
        const decodeMessage = Schema.decodeUnknownEffect(
          Schema.fromJsonString(DesktopHostTelemetryMessage),
        );
        const replayed = yield* publisher.encoded.pipe(
          Stream.mapEffect((bytes) => decodeMessage(decoder.decode(bytes).trim())),
          Stream.filter((message) => message.type === "desktopUpdateStatus"),
          Stream.runHead,
        );
        const replayedReport = Option.getOrThrow(replayed);
        if (replayedReport.type !== "desktopUpdateStatus") {
          return assert.fail("Expected a desktop update status report.");
        }
        assert.equal(replayedReport.outcome, "up-to-date");
        assert.equal(replayedReport.state.currentVersion, "1.2.3");
      }).pipe(Effect.provide(layer));
    }),
  );
});
