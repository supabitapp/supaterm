import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type ClientSettings,
  type CodexMicroDeviceState,
  type CodexMicroInputEvent,
  type CodexMicroLightingModel,
} from "@supaterm/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronPowerMonitor from "../electron/ElectronPowerMonitor.ts";
import * as MacInputMonitoring from "../permissions/MacInputMonitoring.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as CodexMicro from "./CodexMicro.ts";
import {
  EMPTY_LIGHTING_MODEL,
  LIGHTS_OFF_PAYLOAD,
  serializeLighting,
} from "./CodexMicroProtocol.ts";
import * as CodexMicroTransport from "./CodexMicroTransport.ts";

interface FakeRequest {
  readonly method: string;
  readonly params: unknown;
  readonly path: string;
}

type Responder = (
  request: FakeRequest,
) => Effect.Effect<unknown, CodexMicroTransport.CodexMicroRequestError> | undefined;

const USB = { path: "usb", transport: "usb" } as const;
const BLUETOOTH = { path: "bluetooth", transport: "bluetooth" } as const;
const DEVICE_STATUS = { version: "1.0.0", battery: 80, is_charging: false };
const THREAD = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

const settings = (patch: Partial<ClientSettings> = {}): ClientSettings => ({
  ...DEFAULT_CLIENT_SETTINGS,
  codexMicroEnabled: true,
  codexMicroAutoDim: "off",
  ...patch,
});

const modelWith = (
  slot: Partial<CodexMicroLightingModel["slots"][number]>,
): CodexMicroLightingModel => ({
  ...EMPTY_LIGHTING_MODEL,
  slots: EMPTY_LIGHTING_MODEL.slots.map((empty, index) =>
    index === 0 ? { ...empty, ...slot } : empty,
  ),
});

const lighting = (model: CodexMicroLightingModel, highlight = false) =>
  serializeLighting(model, { brightness: 1, highlight, dimmed: false });

const makeFakeTransport = Effect.gen(function* () {
  const requests = yield* Queue.unbounded<FakeRequest>();
  const connections = new Map<
    string,
    {
      readonly events: Queue.Queue<CodexMicroTransport.CodexMicroDeviceEvent>;
      readonly disconnected: Deferred.Deferred<void>;
    }
  >();
  const opened: Array<string> = [];
  let closed = 0;
  let devices: ReadonlyArray<CodexMicroTransport.CodexMicroDevice> = [];
  let responder: Responder = () => undefined;

  const service = CodexMicroTransport.CodexMicroTransport.of({
    discover: Effect.sync(() => devices),
    connect: (device) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const events = yield* Queue.unbounded<CodexMicroTransport.CodexMicroDeviceEvent>();
          const disconnected = yield* Deferred.make<void>();
          opened.push(device.path);
          connections.set(device.path, { events, disconnected });
          return {
            device,
            request: (method, params) =>
              Effect.suspend(() => {
                const request = { method, params: params ?? null, path: device.path };
                Queue.offerUnsafe(requests, request);
                return (
                  responder(request) ??
                  Effect.succeed(method === "device.status" ? DEVICE_STATUS : null)
                );
              }),
            events,
            disconnected: Deferred.await(disconnected),
            idle: Effect.void,
          } satisfies CodexMicroTransport.CodexMicroConnection;
        }),
        () =>
          Effect.sync(() => {
            closed += 1;
          }),
      ),
  });

  return {
    service,
    requests,
    opened,
    closed: () => closed,
    setDevices: (next: ReadonlyArray<CodexMicroTransport.CodexMicroDevice>) => {
      devices = next;
    },
    respond: (next: Responder) => {
      responder = next;
    },
    notify: (path: string, method: string, params: unknown) =>
      Queue.offerUnsafe(connections.get(path)!.events, { type: "notification", method, params }),
    disconnect: (path: string) =>
      Deferred.doneUnsafe(connections.get(path)!.disconnected, Effect.void),
  };
});

const makeHarness = Effect.gen(function* () {
  const transport = yield* makeFakeTransport;
  const power = { idle: "active" as ElectronPowerMonitor.ElectronIdleState };
  const lockedCheck = yield* Deferred.make<void>();
  const layer = CodexMicro.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(CodexMicroTransport.CodexMicroTransport, transport.service),
        Layer.succeed(
          MacInputMonitoring.MacInputMonitoring,
          MacInputMonitoring.MacInputMonitoring.of({
            status: Effect.succeed("granted"),
            requestIfUndetermined: Effect.void,
            openSettings: Effect.void,
          }),
        ),
        Layer.succeed(
          ElectronPowerMonitor.ElectronPowerMonitor,
          ElectronPowerMonitor.ElectronPowerMonitor.of({
            isOnBatteryPower: Effect.succeed(false),
            getSystemIdleTime: Effect.succeed(0),
            getSystemIdleState: (idleThresholdSeconds) =>
              Effect.sync(() => {
                if (idleThresholdSeconds <= 0) throw new TypeError("Invalid idle threshold");
                const idle = power.idle;
                if (idle === "locked") Deferred.doneUnsafe(lockedCheck, Effect.void);
                return idle;
              }),
            getCurrentThermalState: Effect.succeed("nominal"),
            onSimpleEvent: () => Effect.void,
            onThermalStateChange: () => Effect.void,
            onSpeedLimitChange: () => Effect.void,
          }),
        ),
        Layer.succeed(ElectronApp.ElectronApp, {
          on: () => Effect.void,
        } as unknown as ElectronApp.ElectronApp["Service"]),
        DesktopClientSettings.layerTest(),
      ),
    ),
  );
  const codexMicro = Context.get(yield* Layer.build(layer), CodexMicro.CodexMicro);
  const states = yield* Queue.unbounded<CodexMicroDeviceState>();
  const inputs = yield* Queue.unbounded<CodexMicroInputEvent>();
  yield* codexMicro.subscribeState((state) => Queue.offer(states, state).pipe(Effect.asVoid));
  yield* codexMicro.subscribeInput((event) => Queue.offer(inputs, event).pipe(Effect.asVoid));

  const awaitState = Effect.fnUntraced(function* (
    predicate: (state: CodexMicroDeviceState) => boolean,
  ) {
    const skipped: Array<CodexMicroDeviceState> = [];
    while (true) {
      const state = yield* Queue.take(states);
      if (predicate(state)) return { state, skipped };
      skipped.push(state);
    }
  });

  const takeRequests = (count: number) =>
    Effect.forEach(Array.from({ length: count }), () => Queue.take(transport.requests));

  const connect = Effect.gen(function* () {
    yield* codexMicro.configure(settings());
    const startup = yield* takeRequests(3);
    assert.deepStrictEqual(
      startup.map((request) => request.method),
      ["v.oai.rgbcfg", "v.oai.thstatus", "device.status"],
    );
    yield* awaitState((state) => state.status === "connected" && state.battery !== null);
  });

  const key = (path: string, k: string, act: number) =>
    transport.notify(path, "v.oai.hid", { k, act });

  return {
    codexMicro,
    transport,
    power,
    lockedCheck,
    inputs,
    awaitState,
    takeRequests,
    connect,
    key,
  };
});

describe("CodexMicro", () => {
  it.effect("connects, lights the keyboard, then reads battery and firmware", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.transport.setDevices([USB]);
      yield* harness.codexMicro.configure(settings());
      const [rgbcfg, thstatus, status] = yield* harness.takeRequests(3);
      assert.deepStrictEqual(rgbcfg, {
        method: "v.oai.rgbcfg",
        params: lighting(EMPTY_LIGHTING_MODEL).rgbcfg,
        path: "usb",
      });
      assert.deepStrictEqual(thstatus, {
        method: "v.oai.thstatus",
        params: lighting(EMPTY_LIGHTING_MODEL).thstatus,
        path: "usb",
      });
      assert.deepStrictEqual(status, { method: "device.status", params: null, path: "usb" });
      const { state } = yield* harness.awaitState((next) => next.battery !== null);
      assert.deepStrictEqual(state, {
        status: "connected",
        controlPlane: "available",
        transport: "usb",
        error: null,
        battery: { percentage: 80, isCharging: false },
        firmwareVersion: "1.0.0",
        inputMonitoring: "granted",
      });
    }),
  );

  it.effect("stays connected with a limited control plane until lighting recovers", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.transport.setDevices([USB]);
      let rejectLighting = true;
      harness.transport.respond((request) =>
        rejectLighting && request.method === "v.oai.rgbcfg"
          ? Effect.fail(
              new CodexMicroTransport.CodexMicroRpcError({ method: request.method, code: 1 }),
            )
          : undefined,
      );
      yield* harness.codexMicro.configure(settings());
      assert.strictEqual((yield* Queue.take(harness.transport.requests)).method, "v.oai.rgbcfg");
      yield* harness.awaitState(
        (state) => state.status === "connected" && state.controlPlane === "unavailable",
      );

      rejectLighting = false;
      yield* TestClock.adjust(Duration.seconds(1));
      const recovered = yield* harness.takeRequests(3);
      assert.deepStrictEqual(
        recovered.map((request) => request.method),
        ["v.oai.rgbcfg", "v.oai.thstatus", "device.status"],
      );
      yield* harness.awaitState((state) => state.controlPlane === "available");
    }),
  );

  it.effect("retries a timed-out lighting write once on the same connection", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.transport.setDevices([USB]);
      let timeouts = 1;
      harness.transport.respond((request) =>
        request.method === "v.oai.rgbcfg" && timeouts-- > 0
          ? Effect.fail(new CodexMicroTransport.CodexMicroTimeoutError({ method: request.method }))
          : undefined,
      );
      yield* harness.codexMicro.configure(settings());
      const requests = yield* harness.takeRequests(4);
      assert.deepStrictEqual(
        requests.map((request) => request.method),
        ["v.oai.rgbcfg", "v.oai.rgbcfg", "v.oai.thstatus", "device.status"],
      );
      const { skipped, state } = yield* harness.awaitState((next) => next.battery !== null);
      assert.strictEqual(state.controlPlane, "available");
      assert.isFalse(
        skipped.some((next) => next.controlPlane === "unavailable" && next.status === "connected"),
      );
      assert.deepStrictEqual(harness.transport.opened, ["usb"]);
    }),
  );

  it.effect("reconnects with backoff after the device disconnects", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.transport.setDevices([USB]);
      yield* harness.connect;

      harness.transport.disconnect("usb");
      yield* harness.awaitState((state) => state.status === "detected");
      assert.deepStrictEqual(harness.transport.opened, ["usb"]);
      assert.strictEqual(harness.transport.closed(), 1);

      yield* TestClock.adjust(Duration.seconds(1));
      assert.strictEqual((yield* Queue.take(harness.transport.requests)).method, "v.oai.rgbcfg");
      assert.deepStrictEqual(harness.transport.opened, ["usb", "usb"]);
      yield* harness.awaitState((state) => state.status === "connected");
    }),
  );

  it.effect("hands a Bluetooth connection to USB without reporting it lost", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.transport.setDevices([BLUETOOTH]);
      yield* harness.connect;

      harness.transport.setDevices([USB, BLUETOOTH]);
      yield* TestClock.adjust(Duration.seconds(10));
      const next = yield* Queue.take(harness.transport.requests);
      assert.deepStrictEqual(next, {
        method: "v.oai.rgbcfg",
        params: lighting(EMPTY_LIGHTING_MODEL).rgbcfg,
        path: "usb",
      });
      const { state, skipped } = yield* harness.awaitState((update) => update.transport === "usb");
      assert.isTrue(skipped.every((update) => update.status === "connected"));
      assert.strictEqual(state.status, "connected");
      assert.deepStrictEqual(state.battery, { percentage: 80, isCharging: false });
      assert.deepStrictEqual(harness.transport.opened, ["bluetooth", "usb"]);
    }),
  );

  it.effect("turns the lights off and closes the device when disabled", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.transport.setDevices([USB]);
      yield* harness.connect;

      yield* harness.codexMicro.configure(settings({ codexMicroEnabled: false }));
      const [rgbcfg, thstatus] = yield* harness.takeRequests(2);
      assert.deepStrictEqual(rgbcfg?.params, LIGHTS_OFF_PAYLOAD.rgbcfg);
      assert.deepStrictEqual(thstatus?.params, LIGHTS_OFF_PAYLOAD.thstatus);
      assert.strictEqual(harness.transport.closed(), 1);
      assert.strictEqual((yield* harness.codexMicro.state).status, "disabled");
    }),
  );

  it.effect("attaches the displayed thread to agent keys and focuses on a double tap", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.transport.setDevices([USB]);
      yield* harness.connect;
      yield* harness.codexMicro.setLighting(modelWith({ thread: THREAD, status: "idle" }));
      assert.strictEqual((yield* Queue.take(harness.transport.requests)).method, "v.oai.thstatus");

      harness.key("usb", "AG00", 1);
      assert.deepStrictEqual(yield* Queue.take(harness.inputs), {
        type: "agent-key",
        key: "AG00",
        thread: THREAD,
        focus: false,
      });
      yield* TestClock.adjust(Duration.millis(200));
      harness.key("usb", "AG00", 1);
      assert.deepStrictEqual(yield* Queue.take(harness.inputs), {
        type: "agent-key",
        key: "AG00",
        thread: THREAD,
        focus: true,
      });
      harness.key("usb", "AG01", 1);
      harness.key("usb", "AG00", 1);
      const events = [yield* Queue.take(harness.inputs), yield* Queue.take(harness.inputs)];
      assert.deepStrictEqual(events, [
        { type: "agent-key", key: "AG01", thread: null, focus: false },
        { type: "agent-key", key: "AG00", thread: THREAD, focus: false },
      ]);
      yield* TestClock.adjust(Duration.millis(400));
      harness.key("usb", "AG00", 1);
      assert.deepStrictEqual(yield* Queue.take(harness.inputs), {
        type: "agent-key",
        key: "AG00",
        thread: THREAD,
        focus: false,
      });

      yield* harness.codexMicro.configure(settings({ codexMicroSingleTapFocus: true }));
      harness.key("usb", "AG00", 1);
      const single = yield* Queue.take(harness.inputs);
      assert.isTrue(single.type === "agent-key" && single.focus);
    }),
  );

  it.effect("focuses on a second press of the same key within the double-tap window", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.transport.setDevices([USB]);
      yield* harness.connect;
      harness.key("usb", "AG02", 1);
      harness.key("usb", "AG02", 1);
      const [first, second] = [
        yield* Queue.take(harness.inputs),
        yield* Queue.take(harness.inputs),
      ];
      assert.deepStrictEqual(first, { type: "agent-key", key: "AG02", thread: null, focus: false });
      assert.deepStrictEqual(second, { type: "agent-key", key: "AG02", thread: null, focus: true });
    }),
  );

  it.effect("turns a held knob press into a long press and swallows its release", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.transport.setDevices([USB]);
      yield* harness.connect;

      harness.key("usb", "ENC_SW", 1);
      harness.key("usb", "ENC_CW", 2);
      assert.deepStrictEqual(yield* Queue.take(harness.inputs), {
        type: "encoder",
        input: "right",
      });
      yield* TestClock.adjust(Duration.millis(500));
      assert.deepStrictEqual(yield* Queue.take(harness.inputs), {
        type: "encoder",
        input: "longPress",
      });
      harness.key("usb", "ENC_SW", 0);
      harness.key("usb", "ENC_CC", 2);
      assert.deepStrictEqual(yield* Queue.take(harness.inputs), { type: "encoder", input: "left" });

      harness.key("usb", "ENC_SW", 1);
      harness.key("usb", "ENC_CW", 2);
      assert.deepStrictEqual(yield* Queue.take(harness.inputs), {
        type: "encoder",
        input: "right",
      });
      yield* TestClock.adjust(Duration.millis(200));
      harness.key("usb", "ENC_SW", 0);
      assert.deepStrictEqual(yield* Queue.take(harness.inputs), {
        type: "encoder",
        input: "click",
      });
    }),
  );

  it.effect("drops a knob hold that completes after the screen locks", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.transport.setDevices([USB]);
      yield* harness.connect;

      harness.key("usb", "ENC_SW", 1);
      harness.key("usb", "ENC_CW", 2);
      assert.deepStrictEqual(yield* Queue.take(harness.inputs), {
        type: "encoder",
        input: "right",
      });
      harness.power.idle = "locked";
      yield* TestClock.adjust(Duration.millis(500));
      yield* Deferred.await(harness.lockedCheck);
      harness.power.idle = "active";
      harness.key("usb", "ENC_CC", 2);
      assert.deepStrictEqual(yield* Queue.take(harness.inputs), { type: "encoder", input: "left" });
    }),
  );

  it.effect("maps action keys and joystick edges and drops input while locked", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.transport.setDevices([USB]);
      yield* harness.connect;

      harness.key("usb", "ACT10", 1);
      harness.key("usb", "ACT11", 1);
      harness.key("usb", "ACT07", 0);
      harness.transport.notify("usb", "v.oai.rad", { a: 0.7, d: 1 });
      harness.transport.notify("usb", "v.oai.rad", { a: 0.75, d: 0.8 });
      harness.transport.notify("usb", "v.oai.rad", { a: 0.2, d: 0.9 });
      const events = [];
      for (let index = 0; index < 4; index += 1) events.push(yield* Queue.take(harness.inputs));
      assert.deepStrictEqual(events, [
        { type: "key", slot: "ACT10_ACT11", phase: "press" },
        { type: "key", slot: "ACT07", phase: "release" },
        { type: "joystick", direction: "up" },
        { type: "joystick", direction: "down" },
      ]);

      harness.power.idle = "locked";
      harness.key("usb", "ACT06", 1);
      yield* Deferred.await(harness.lockedCheck);
      harness.power.idle = "active";
      harness.key("usb", "ACT12", 1);
      assert.deepStrictEqual(yield* Queue.take(harness.inputs), {
        type: "key",
        slot: "ACT12",
        phase: "press",
      });
    }),
  );

  it.effect("dims after inactivity and restores lighting on input", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.transport.setDevices([USB]);
      yield* harness.connect;
      yield* harness.codexMicro.configure(settings({ codexMicroAutoDim: "30-seconds" }));
      const working = modelWith({ thread: THREAD, status: "working", selected: true });
      yield* harness.codexMicro.setLighting(working);
      const lit = yield* harness.takeRequests(2);
      assert.deepStrictEqual(
        lit.map((request) => request.params),
        [lighting(working, true).rgbcfg, lighting(working, true).thstatus],
      );

      yield* TestClock.adjust(Duration.seconds(30));
      const [highlightEnded, ...dimmed] = yield* harness.takeRequests(3);
      assert.deepStrictEqual(highlightEnded?.params, lighting(working).rgbcfg);
      assert.deepStrictEqual(
        dimmed.map((request) => request.params),
        [LIGHTS_OFF_PAYLOAD.rgbcfg, LIGHTS_OFF_PAYLOAD.thstatus],
      );

      harness.key("usb", "ACT07", 1);
      assert.strictEqual((yield* Queue.take(harness.inputs)).type, "key");
      yield* TestClock.adjust(Duration.millis(100));
      const restored = yield* harness.takeRequests(2);
      assert.deepStrictEqual(
        restored.map((request) => request.params),
        [lighting(working).rgbcfg, lighting(working).thstatus],
      );
    }),
  );
});
