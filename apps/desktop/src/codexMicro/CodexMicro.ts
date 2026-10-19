import {
  CODEX_MICRO_AUTO_DIM_MS,
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
  type CodexMicroAgentKey,
  type CodexMicroConnectionStatus,
  type CodexMicroDeviceState,
  type CodexMicroInputEvent,
  type CodexMicroJoystickDirection,
  type CodexMicroLightingModel,
  type CodexMicroThreadRef,
} from "@supaterm/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Fiber from "effect/Fiber";
import * as FiberHandle from "effect/FiberHandle";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronPowerMonitor from "../electron/ElectronPowerMonitor.ts";
import * as MacInputMonitoring from "../permissions/MacInputMonitoring.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import {
  DEVICE_STATUS_METHOD,
  EMPTY_LIGHTING_MODEL,
  JOYSTICK_NOTIFICATION_METHOD,
  KEY_ACT_PRESS,
  KEY_ACT_RELEASE,
  KEY_ACT_ROTATE,
  KEY_NOTIFICATION_METHOD,
  LIGHTS_OFF_PAYLOAD,
  RGB_CONFIG_METHOD,
  THREAD_STATUS_METHOD,
  actionSlotFromWire,
  agentKeySlotIndex,
  decodeDeviceStatus,
  decodeJoystickNotification,
  decodeKeyNotification,
  isAgentKey,
  selectedLightingSlot,
  serializeLighting,
  trackJoystick,
  type CodexMicroLightingPayload,
} from "./CodexMicroProtocol.ts";
import * as CodexMicroTransport from "./CodexMicroTransport.ts";

const DISCOVERY_INTERVAL = Duration.seconds(2);
const HANDOFF_SCAN_INTERVAL = Duration.seconds(10);
const DEVICE_STATUS_INTERVAL = Duration.seconds(60);
const SELECTION_HIGHLIGHT = Duration.seconds(4);
const KNOB_HOLD = Duration.millis(500);
const STOP_TIMEOUT = Duration.seconds(10);
const RETRY_DELAYS = [
  Duration.seconds(1),
  Duration.seconds(2),
  Duration.seconds(5),
  Duration.seconds(10),
] as const;
const INPUT_QUIET_MS = 100;
const AGENT_DOUBLE_TAP_MS = 350;
const JOYSTICK_ACTIVITY_DISTANCE = 0.1;
const DEBUG_LINE_LOG_LIMIT = 200;
// Electron rejects a zero threshold; the locked state does not depend on it.
const LOCK_CHECK_IDLE_THRESHOLD_SECONDS = 1;

const { logDebug, logInfo, logWarning } = makeComponentLogger("desktop-codex-micro");

const retryDelay = (attempt: number) =>
  RETRY_DELAYS[Math.min(Math.max(attempt, 1), RETRY_DELAYS.length) - 1]!;

const readSettings = (settings: ClientSettings) => ({
  enabled: settings.codexMicroEnabled,
  singleTapFocus: settings.codexMicroSingleTapFocus,
  brightness: settings.codexMicroBrightness / 100,
  autoDimMs: CODEX_MICRO_AUTO_DIM_MS[settings.codexMicroAutoDim],
  separateMicrophoneKeys: settings.codexMicroLayout.separateMicrophoneKeys,
});

const deviceState = (
  status: CodexMicroConnectionStatus,
  inputMonitoring: CodexMicroDeviceState["inputMonitoring"],
): CodexMicroDeviceState => ({
  status,
  controlPlane: "unavailable",
  transport: null,
  error: null,
  battery: null,
  firmwareVersion: null,
  inputMonitoring,
});

const sameThread = (left: CodexMicroThreadRef | null, right: CodexMicroThreadRef | null) =>
  left === null || right === null
    ? left === right
    : left.environmentId === right.environmentId && left.threadId === right.threadId;

type StateListener = (state: CodexMicroDeviceState) => Effect.Effect<void>;
type InputListener = (event: CodexMicroInputEvent) => Effect.Effect<void>;

type SessionEnd =
  | { readonly reason: "lost"; readonly healthy: boolean }
  | { readonly reason: "handoff" };

export class CodexMicro extends Context.Service<
  CodexMicro,
  {
    readonly initialize: Effect.Effect<void>;
    /** Cheap and idempotent: runs on every client-settings write. */
    readonly configure: (settings: ClientSettings) => Effect.Effect<void>;
    readonly state: Effect.Effect<CodexMicroDeviceState>;
    readonly setLighting: (model: CodexMicroLightingModel) => Effect.Effect<void>;
    readonly openInputMonitoringSettings: Effect.Effect<void>;
    readonly subscribeState: (listener: StateListener) => Effect.Effect<void, never, Scope.Scope>;
    readonly subscribeInput: (listener: InputListener) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@supaterm/desktop/codexMicro/CodexMicro") {}

const make = Effect.gen(function* () {
  const transport = yield* CodexMicroTransport.CodexMicroTransport;
  const inputMonitoring = yield* MacInputMonitoring.MacInputMonitoring;
  const powerMonitor = yield* ElectronPowerMonitor.ElectronPowerMonitor;
  const electronApp = yield* ElectronApp.ElectronApp;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const serviceScope = yield* Effect.scope;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());

  let settings = readSettings(DEFAULT_CLIENT_SETTINGS);
  let state = deviceState("disabled", "unavailable");
  const stateListeners = new Set<StateListener>();
  const inputListeners = new Set<InputListener>();

  let latestModel = EMPTY_LIGHTING_MODEL;
  let selectionKey: string | null = null;
  let highlight = false;
  let dimmed = false;
  let activityId = 0;
  let lastInputAt = Number.NEGATIVE_INFINITY;
  let screenLocked = false;
  let enabledFiber: Fiber.Fiber<void> | undefined;
  // A USB interface that would not open keeps the Bluetooth session until it
  // disappears, such as on replug, instead of forcing a handoff every scan.
  const unopenableUsbPaths = new Set<string>();

  const forgetVanishedUsb = (devices: ReadonlyArray<CodexMicroTransport.CodexMicroDevice>) => {
    for (const path of unopenableUsbPaths) {
      if (!devices.some((device) => device.path === path)) unopenableUsbPaths.delete(path);
    }
  };
  const hasOpenableUsb = (devices: ReadonlyArray<CodexMicroTransport.CodexMicroDevice>) =>
    devices.some((device) => device.transport === "usb" && !unopenableUsbPaths.has(device.path));

  const lifecycle = yield* Semaphore.make(1);
  const lightingWake = yield* Queue.sliding<void>(1);
  const rescan = yield* Queue.sliding<void>(1);
  const dimTimer = yield* FiberHandle.make<void, never>();
  const highlightTimer = yield* FiberHandle.make<void, never>();

  const publish = (next: CodexMicroDeviceState) =>
    Effect.suspend(() => {
      if (Equal.equals(next, state)) return Effect.void;
      state = next;
      return Effect.forEach(stateListeners, (listener) => listener(next), { discard: true });
    });

  const patchState = (patch: Partial<CodexMicroDeviceState>) =>
    Effect.suspend(() => publish({ ...state, ...patch }));

  const publishStatus = (
    status: CodexMicroConnectionStatus,
    patch: Partial<CodexMicroDeviceState> = {},
  ) => Effect.suspend(() => publish({ ...deviceState(status, state.inputMonitoring), ...patch }));

  const refreshInputMonitoring = Effect.gen(function* () {
    const inputMonitoringStatus = yield* inputMonitoring.status;
    yield* patchState({ inputMonitoring: inputMonitoringStatus });
  });

  const emitInput = (event: CodexMicroInputEvent) =>
    Effect.forEach(inputListeners, (listener) => listener(event), { discard: true });

  const wakeLighting = Queue.offer(lightingWake, undefined).pipe(Effect.asVoid);

  const scheduleDim = Effect.suspend(() => {
    const delay = settings.autoDimMs;
    if (delay === null || !settings.enabled) return FiberHandle.clear(dimTimer);
    const scheduledActivity = activityId;
    return FiberHandle.run(
      dimTimer,
      Effect.sleep(Duration.millis(delay)).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (scheduledActivity !== activityId || dimmed) return Effect.void;
            dimmed = true;
            return wakeLighting;
          }),
        ),
      ),
    ).pipe(Effect.asVoid);
  });

  const markActivity = Effect.gen(function* () {
    activityId += 1;
    if (dimmed) {
      dimmed = false;
      yield* wakeLighting;
    }
    yield* scheduleDim;
  });

  const waitForInputQuiet = Effect.gen(function* () {
    while (true) {
      const remaining = lastInputAt + INPUT_QUIET_MS - (yield* Clock.currentTimeMillis);
      if (remaining <= 0) return;
      yield* Effect.sleep(Duration.millis(remaining));
    }
  });

  const waitForRescan = (delay: Duration.Duration) =>
    Queue.take(rescan).pipe(Effect.timeoutOrElse({ duration: delay, orElse: () => Effect.void }));

  const inputLocked = Effect.suspend(() =>
    screenLocked
      ? Effect.succeed(true)
      : powerMonitor
          .getSystemIdleState(LOCK_CHECK_IDLE_THRESHOLD_SECONDS)
          .pipe(Effect.map((idle) => idle === "locked")),
  );

  const runSession = Effect.fn("desktop.codexMicro.session")(function* (
    device: CodexMicroTransport.CodexMicroDevice,
    handoff: boolean,
  ) {
    const connection = yield* transport.connect(device);
    unopenableUsbPaths.delete(device.path);
    const sessionScope = yield* Effect.scope;
    const ended = yield* Deferred.make<SessionEnd>();
    const knobTimer = yield* FiberHandle.make<void, never>();
    let sessionEnded = false;
    let initialized = false;
    let stopping = false;
    let controlPlane: CodexMicroDeviceState["controlPlane"] = "available";
    let displayedModel: CodexMicroLightingModel | null = null;
    let appliedRgb: CodexMicroLightingPayload["rgbcfg"] | null = null;
    let appliedThreads: CodexMicroLightingPayload["thstatus"] | null = null;
    let lastAgentPress: {
      readonly key: CodexMicroAgentKey;
      readonly thread: CodexMicroThreadRef | null;
      readonly at: number;
    } | null = null;
    let joystickDirection: CodexMicroJoystickDirection | null = null;
    let knobHoldPending = false;

    const endLost = Effect.suspend(() =>
      Deferred.succeed(ended, { reason: "lost", healthy: initialized }),
    );

    const request = (method: string, params?: unknown) =>
      connection
        .request(method, params)
        .pipe(
          Effect.tapError((error) =>
            CodexMicroTransport.isCodexMicroTransportFailure(error) ? endLost : Effect.void,
          ),
        );

    const setControlPlane = (next: CodexMicroDeviceState["controlPlane"]) =>
      Effect.suspend(() => {
        if (controlPlane === next || stopping) return Effect.void;
        controlPlane = next;
        return patchState({ controlPlane: next });
      });

    const writeLighting = (method: string, params: unknown) =>
      request(method, params).pipe(
        Effect.catchTags({ CodexMicroTimeoutError: () => request(method, params) }),
      );

    const applyLighting = Effect.gen(function* () {
      const model = latestModel;
      const payload = serializeLighting(model, {
        brightness: settings.brightness,
        highlight,
        dimmed,
      });
      if (!Equal.equals(payload.rgbcfg, appliedRgb)) {
        if (stopping) return;
        yield* writeLighting(RGB_CONFIG_METHOD, payload.rgbcfg);
        appliedRgb = payload.rgbcfg;
      }
      if (!Equal.equals(payload.thstatus, appliedThreads)) {
        if (stopping) return;
        yield* writeLighting(THREAD_STATUS_METHOD, payload.thstatus);
        appliedThreads = payload.thstatus;
      }
      displayedModel = model;
    });

    const refreshDeviceStatus = Effect.gen(function* () {
      yield* waitForInputQuiet;
      if (stopping) return;
      const result = yield* Effect.result(request(DEVICE_STATUS_METHOD));
      if (Result.isFailure(result)) {
        if (!CodexMicroTransport.isCodexMicroTransportFailure(result.failure)) {
          yield* patchState({ battery: null });
        }
        return;
      }
      yield* Option.match(decodeDeviceStatus(result.success), {
        onNone: () => patchState({ battery: null }),
        onSome: (status) =>
          patchState({
            battery:
              status.battery === undefined
                ? null
                : { percentage: status.battery, isCharging: status.is_charging ?? null },
            ...(status.version === undefined ? {} : { firmwareVersion: status.version }),
          }),
      });
    });

    const lightingLoop = Effect.gen(function* () {
      let failures = 0;
      while (true) {
        yield* waitForInputQuiet;
        const result = yield* Effect.result(applyLighting);
        if (stopping) return;
        if (Result.isSuccess(result)) {
          failures = 0;
          yield* setControlPlane("available");
          if (!initialized) {
            initialized = true;
            yield* Effect.forkIn(
              refreshDeviceStatus.pipe(
                Effect.andThen(Effect.sleep(DEVICE_STATUS_INTERVAL)),
                Effect.forever,
              ),
              sessionScope,
            );
          }
          yield* Queue.take(lightingWake);
          continue;
        }
        if (CodexMicroTransport.isCodexMicroTransportFailure(result.failure)) return;
        appliedRgb = null;
        appliedThreads = null;
        failures += 1;
        yield* setControlPlane("unavailable");
        yield* (failures === 1 ? logWarning : logDebug)("lighting update failed", {
          error: result.failure._tag,
          attempt: failures,
        });
        yield* Effect.sleep(retryDelay(failures));
      }
    });

    const modelForInput = () =>
      controlPlane === "available" && displayedModel !== null ? displayedModel : latestModel;

    const handleAgentKey = Effect.fnUntraced(function* (key: CodexMicroAgentKey) {
      const thread = modelForInput().slots[agentKeySlotIndex(key)]?.thread ?? null;
      const now = yield* Clock.currentTimeMillis;
      const previous = lastAgentPress;
      const repeated =
        previous !== null &&
        previous.key === key &&
        sameThread(previous.thread, thread) &&
        now - previous.at <= AGENT_DOUBLE_TAP_MS;
      const focus = settings.singleTapFocus || repeated;
      lastAgentPress = focus ? null : { key, thread, at: now };
      yield* emitInput({ type: "agent-key", key, thread, focus });
    });

    const pressKnob = Effect.suspend(() => {
      knobHoldPending = true;
      return FiberHandle.run(
        knobTimer,
        Effect.sleep(KNOB_HOLD).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              knobHoldPending = false;
              // The screen can lock while the knob is held.
              return inputLocked.pipe(
                Effect.flatMap((locked) =>
                  locked ? Effect.void : emitInput({ type: "encoder", input: "longPress" }),
                ),
              );
            }),
          ),
        ),
      ).pipe(Effect.asVoid);
    });

    // A release after the hold fired belongs to the long press and is swallowed.
    const releaseKnob = Effect.suspend(() => {
      if (!knobHoldPending) return Effect.void;
      knobHoldPending = false;
      return FiberHandle.clear(knobTimer).pipe(
        Effect.andThen(emitInput({ type: "encoder", input: "click" })),
      );
    });

    const handleKey = Effect.fnUntraced(function* (key: string, act: number) {
      yield* markActivity;
      if (isAgentKey(key)) {
        if (act === KEY_ACT_PRESS) yield* handleAgentKey(key);
        return;
      }
      const slot = actionSlotFromWire(key, settings.separateMicrophoneKeys);
      if (slot !== undefined) {
        if (act === KEY_ACT_PRESS || act === KEY_ACT_RELEASE) {
          yield* emitInput({
            type: "key",
            slot,
            phase: act === KEY_ACT_PRESS ? "press" : "release",
          });
        }
        return;
      }
      if (key === "ENC_CW" || key === "ENC_CC") {
        if (act === KEY_ACT_ROTATE) {
          yield* emitInput({ type: "encoder", input: key === "ENC_CW" ? "right" : "left" });
        }
        return;
      }
      if (!key.startsWith("ENC")) return;
      if (act === KEY_ACT_PRESS) yield* pressKnob;
      else if (act === KEY_ACT_RELEASE) yield* releaseKnob;
    });

    const handleJoystick = Effect.fnUntraced(function* (angle: number, distance: number) {
      if (distance > JOYSTICK_ACTIVITY_DISTANCE) yield* markActivity;
      const next = trackJoystick(joystickDirection, { angle, distance });
      joystickDirection = next.last;
      if (next.emit !== null) yield* emitInput({ type: "joystick", direction: next.emit });
    });

    const inputLoop = Effect.gen(function* () {
      while (true) {
        const event = yield* Queue.take(connection.events);
        if (event.type === "debug") {
          yield* logDebug("device debug output", {
            line: event.line.slice(0, DEBUG_LINE_LOG_LIMIT),
          });
          continue;
        }
        const isKey = event.method === KEY_NOTIFICATION_METHOD;
        if (stopping || (!isKey && event.method !== JOYSTICK_NOTIFICATION_METHOD)) continue;
        if (yield* inputLocked) continue;
        lastInputAt = yield* Clock.currentTimeMillis;
        if (isKey) {
          const key = decodeKeyNotification(event.params);
          if (Option.isSome(key)) yield* handleKey(key.value.k, key.value.act);
        } else {
          const sample = decodeJoystickNotification(event.params);
          if (Option.isSome(sample)) yield* handleJoystick(sample.value.a, sample.value.d);
        }
      }
    });

    const handoffLoop = Effect.gen(function* () {
      while (true) {
        yield* waitForRescan(HANDOFF_SCAN_INTERVAL);
        const devices = yield* transport.discover.pipe(
          Effect.orElseSucceed((): ReadonlyArray<CodexMicroTransport.CodexMicroDevice> => []),
        );
        forgetVanishedUsb(devices);
        if (hasOpenableUsb(devices)) {
          yield* Deferred.succeed(ended, { reason: "handoff" });
          return;
        }
      }
    });

    yield* publishStatus("connected", {
      controlPlane,
      transport: device.transport,
      battery: handoff ? state.battery : null,
      firmwareVersion: handoff ? state.firmwareVersion : null,
    });
    yield* logInfo("connected", { transport: device.transport });
    yield* markActivity;
    yield* Effect.forkScoped(connection.disconnected.pipe(Effect.andThen(endLost)));
    yield* Effect.forkScoped(inputLoop);
    yield* Effect.forkScoped(lightingLoop);
    if (device.transport === "bluetooth") yield* Effect.forkScoped(handoffLoop);

    // Registered after the workers so it runs first on close: a disable or quit
    // lets the in-flight request finish, then turns the lights off.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        stopping = true;
        if (sessionEnded) return;
        const lightsOff = Effect.gen(function* () {
          yield* connection.idle;
          if (controlPlane !== "available") return;
          yield* connection.request(RGB_CONFIG_METHOD, LIGHTS_OFF_PAYLOAD.rgbcfg);
          yield* connection.request(THREAD_STATUS_METHOD, LIGHTS_OFF_PAYLOAD.thstatus);
        });
        yield* lightsOff.pipe(Effect.timeoutOption(STOP_TIMEOUT), Effect.ignore);
      }),
    );

    const end = yield* Deferred.await(ended);
    sessionEnded = true;
    return end;
  });

  const runEnabled = Effect.gen(function* () {
    yield* powerMonitor.onSimpleEvent("lock-screen", () => {
      screenLocked = true;
    });
    yield* powerMonitor.onSimpleEvent("unlock-screen", () => {
      screenLocked = false;
    });
    yield* powerMonitor.onSimpleEvent("resume", () => {
      Queue.offerUnsafe(rescan, undefined);
    });
    yield* electronApp.on("browser-window-focus", () => {
      runFork(refreshInputMonitoring);
    });
    screenLocked =
      (yield* powerMonitor.getSystemIdleState(LOCK_CHECK_IDLE_THRESHOLD_SECONDS)) === "locked";
    yield* refreshInputMonitoring;

    unopenableUsbPaths.clear();
    let failures = 0;
    let previous: SessionEnd["reason"] | "open-failed" | undefined;
    while (true) {
      const discovered = yield* transport.discover.pipe(
        Effect.map((devices) => ({ devices, error: null })),
        Effect.catchTags({
          CodexMicroHidLoadError: () =>
            Effect.succeed({ devices: [], error: "transport-unavailable" as const }),
          CodexMicroDiscoveryError: () =>
            Effect.succeed({ devices: [], error: "discovery-failed" as const }),
        }),
      );
      if (discovered.error !== null) {
        if (state.error !== discovered.error) {
          yield* logWarning("discovery failed", { error: discovered.error });
        }
        previous = undefined;
        yield* publishStatus("error", { error: discovered.error });
        yield* waitForRescan(DISCOVERY_INTERVAL);
        continue;
      }
      forgetVanishedUsb(discovered.devices);
      if (discovered.devices.length === 0) {
        failures = 0;
        previous = undefined;
        yield* publishStatus("not-detected");
        yield* waitForRescan(DISCOVERY_INTERVAL);
        continue;
      }
      if (previous !== "handoff" && previous !== "open-failed") {
        yield* publishStatus("detected");
      }
      if (failures > 0) yield* Effect.sleep(retryDelay(failures));

      let outcome: SessionEnd | undefined;
      for (const device of discovered.devices) {
        outcome = yield* Effect.scoped(runSession(device, previous === "handoff")).pipe(
          Effect.catchTags({
            CodexMicroConnectError: (error) => {
              if (device.transport === "usb") unopenableUsbPaths.add(device.path);
              return logWarning("could not open the keyboard", { transport: error.transport }).pipe(
                Effect.as(undefined),
              );
            },
          }),
        );
        if (outcome !== undefined) break;
      }

      if (outcome === undefined) {
        failures += 1;
        previous = "open-failed";
        yield* publishStatus("error", { error: "connection-failed" });
      } else if (outcome.reason === "handoff") {
        failures = 0;
        previous = "handoff";
        yield* logInfo("switching to USB");
      } else {
        failures = outcome.healthy ? 1 : failures + 1;
        previous = "lost";
        yield* logInfo("connection lost");
      }
    }
  }).pipe(Effect.scoped, Effect.withSpan("desktop.codexMicro.run"));

  const start = Effect.gen(function* () {
    if (enabledFiber !== undefined) return;
    yield* inputMonitoring.requestIfUndetermined;
    enabledFiber = yield* Effect.forkIn(runEnabled, serviceScope);
  });

  const stop = Effect.gen(function* () {
    const fiber = enabledFiber;
    enabledFiber = undefined;
    if (fiber !== undefined) yield* Fiber.interrupt(fiber);
    yield* FiberHandle.clear(dimTimer);
    dimmed = false;
    yield* publishStatus("disabled");
  });

  const configure = Effect.fn("desktop.codexMicro.configure")(function* (
    clientSettings: ClientSettings,
  ) {
    const previous = settings;
    settings = readSettings(clientSettings);
    if (settings.brightness !== previous.brightness) yield* wakeLighting;
    if (settings.autoDimMs !== previous.autoDimMs) {
      if (settings.autoDimMs === null && dimmed) {
        dimmed = false;
        yield* wakeLighting;
      }
      yield* scheduleDim;
    }
    if (settings.enabled !== previous.enabled) {
      yield* lifecycle.withPermit(Effect.suspend(() => (settings.enabled ? start : stop)));
    }
  });

  const setLighting = Effect.fn("desktop.codexMicro.setLighting")(function* (
    model: CodexMicroLightingModel,
  ) {
    if (Equal.equals(model, latestModel)) return;
    latestModel = model;
    const selected = selectedLightingSlot(model);
    const nextSelection =
      selected === undefined
        ? null
        : `${selected.index}:${selected.slot.thread?.environmentId ?? ""}:${selected.slot.thread?.threadId ?? ""}`;
    if (nextSelection !== selectionKey) {
      selectionKey = nextSelection;
      highlight = nextSelection !== null;
      if (highlight) {
        yield* FiberHandle.run(
          highlightTimer,
          Effect.sleep(SELECTION_HIGHLIGHT).pipe(
            Effect.andThen(
              Effect.suspend(() => {
                highlight = false;
                return wakeLighting;
              }),
            ),
          ),
        );
      } else {
        yield* FiberHandle.clear(highlightTimer);
      }
    }
    yield* markActivity;
    yield* wakeLighting;
  });

  const subscribe = <A>(listeners: Set<A>, listener: A) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        listeners.add(listener);
      }),
      () =>
        Effect.sync(() => {
          listeners.delete(listener);
        }),
    );

  return CodexMicro.of({
    initialize: clientSettings.get.pipe(
      Effect.map(Option.getOrElse(() => DEFAULT_CLIENT_SETTINGS)),
      Effect.flatMap(configure),
      Effect.catchTags({
        DesktopClientSettingsReadError: (error) =>
          logWarning("could not read client settings", { operation: error.operation }),
      }),
      Effect.withSpan("desktop.codexMicro.initialize"),
    ),
    configure,
    state: refreshInputMonitoring.pipe(
      Effect.andThen(Effect.sync(() => state)),
      Effect.withSpan("desktop.codexMicro.state"),
    ),
    setLighting,
    openInputMonitoringSettings: inputMonitoring.openSettings.pipe(
      Effect.andThen(refreshInputMonitoring),
      Effect.withSpan("desktop.codexMicro.openInputMonitoringSettings"),
    ),
    subscribeState: (listener) => subscribe(stateListeners, listener),
    subscribeInput: (listener) => subscribe(inputListeners, listener),
  });
});

export const layer = Layer.effect(CodexMicro, make);
