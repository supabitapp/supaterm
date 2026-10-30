import {
  DeviceBootError,
  type DeviceHostId,
  DeviceOperationError,
  type DevicePlatform,
  type DevicePlatformAvailability,
} from "@supaterm/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import type { DeviceHostReady, DeviceOperations, HostDevice } from "./DeviceHost.ts";

const BOOT_TIMEOUT = Duration.minutes(3);
const SCREENSHOT_TIMEOUT = Duration.seconds(20);
const IOS_RUNTIME_PREFIX = "com.apple.CoreSimulator.SimRuntime.iOS-";

const HubDevice = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  platform: Schema.Literals(["ios", "android"]),
  booted: Schema.Boolean,
  physical: Schema.Boolean,
});
const HubDeviceList = Schema.Struct({
  simulators: Schema.Array(HubDevice),
  emulators: Schema.Array(HubDevice),
  errors: Schema.optional(
    Schema.Array(Schema.Struct({ message: Schema.String, error: Schema.optional(Schema.String) })),
  ),
});
const decodeSimctlDevices = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      devices: Schema.Record(
        Schema.String,
        Schema.Array(
          Schema.Struct({
            udid: Schema.String,
            name: Schema.String,
            state: Schema.String,
          }),
        ),
      ),
    }),
  ),
);
const HubActionResult = Schema.Struct({
  ok: Schema.Boolean,
  id: Schema.optional(Schema.String),
  serial: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  errors: Schema.optional(
    Schema.Array(Schema.Struct({ message: Schema.String, error: Schema.optional(Schema.String) })),
  ),
});

const vendorPrefix = (platform: DevicePlatform) =>
  platform === "ios" ? "/vendor/serve-sim" : "/vendor/serve-emu";

interface DeviceDiscovery {
  readonly devices: ReadonlyArray<HostDevice>;
  readonly detail?: string;
}

const listIosSimulators = Effect.fn("DeviceHubOperations.listIosSimulators")(function* (
  run: DeviceHostReady["run"],
): Effect.fn.Return<DeviceDiscovery> {
  const result = yield* run("xcrun", ["simctl", "list", "devices", "available", "--json"]);
  if (result.code !== 0) {
    return {
      devices: [],
      detail: `Could not list iOS Simulators (xcrun simctl, exit code ${result.code}). Discovered devices remain available.`,
    };
  }
  const parsed = yield* decodeSimctlDevices(result.stdout).pipe(Effect.result);
  if (parsed._tag === "Failure") {
    return {
      devices: [],
      detail:
        "Could not read the iOS Simulator list from xcrun simctl. Discovered devices remain available.",
    };
  }
  return {
    devices: Object.entries(parsed.success.devices).flatMap(([runtime, simulators]) =>
      runtime.startsWith(IOS_RUNTIME_PREFIX)
        ? simulators.map((simulator) => ({
            id: simulator.udid,
            name: simulator.name,
            version: `iOS ${runtime.slice(IOS_RUNTIME_PREFIX.length).replaceAll("-", ".")}`,
            platform: "ios" as const,
            booted: simulator.state === "Booted",
            physical: false,
          }))
        : [],
    ),
  };
});

const listAndroidAvds = Effect.fn("DeviceHubOperations.listAndroidAvds")(function* (
  run: DeviceHostReady["run"],
): Effect.fn.Return<DeviceDiscovery> {
  const result = yield* run("emulator", ["-list-avds"]);
  if (result.code !== 0) {
    return {
      devices: [],
      detail: `Could not list Android virtual devices (emulator -list-avds, exit code ${result.code}). Discovered devices remain available.`,
    };
  }
  return {
    devices: result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => ({
        id: name,
        name,
        platform: "android" as const,
        version: "Android",
        booted: false,
        physical: false,
      })),
  };
});

const discoveryKey = (device: HostDevice) =>
  `${device.platform}:${device.platform === "ios" ? device.id : device.name}`;

/** Device operations for a host that runs expo-device-hub at `origin`. */
export const makeDeviceHubOperations = (options: {
  readonly hostId: DeviceHostId;
  readonly origin: string;
  readonly http: HttpClient.HttpClient;
  readonly run: DeviceHostReady["run"];
  readonly platforms: Effect.Effect<ReadonlyArray<DevicePlatformAvailability>>;
}): DeviceOperations => {
  const { hostId, origin, run } = options;
  const httpClient = options.http.pipe(HttpClient.withScope);

  const hubJson = <A, I>(
    request: HttpClientRequest.HttpClientRequest,
    schema: Schema.Codec<A, I>,
    operation: string,
    timeout: Duration.Input = Duration.seconds(15),
  ) =>
    httpClient.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.scoped,
      Effect.timeout(timeout),
      Effect.mapError(
        (cause) =>
          new DeviceOperationError({
            operation,
            reason: "request_failed",
            cause,
          }),
      ),
    );

  const postJson = (path: string, body: Record<string, string>, operation: string) =>
    HttpClientRequest.post(`${origin}${path}`).pipe(
      HttpClientRequest.bodyJson(body),
      Effect.mapError(
        (cause) => new DeviceOperationError({ operation, reason: "invalid_payload", cause }),
      ),
    );

  // Booting alone does not attach a serve-sim helper; the grid start does both
  // and is idempotent for a booted simulator.
  const attachIosStream = (udid: string, operation: string) =>
    postJson(`${vendorPrefix("ios")}/grid/api/start`, { udid }, operation).pipe(
      Effect.flatMap((request) => hubJson(request, HubActionResult, "attach stream", BOOT_TIMEOUT)),
    );

  const list: DeviceOperations["list"] = Effect.gen(function* () {
    const [hubList, supplemental] = yield* Effect.all(
      [
        hubJson(HttpClientRequest.get(`${origin}/api/devices`), HubDeviceList, "list"),
        options.platforms.pipe(
          Effect.flatMap((platforms) => {
            const available = new Set(
              platforms
                .filter((platform) => platform.available)
                .map((platform) => platform.platform),
            );
            const empty: DeviceDiscovery = { devices: [] };
            return Effect.all(
              {
                ios: available.has("ios") ? listIosSimulators(run) : Effect.succeed(empty),
                android: available.has("android") ? listAndroidAvds(run) : Effect.succeed(empty),
              },
              { concurrency: "unbounded" },
            );
          }),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const devices: Array<HostDevice> = [...hubList.simulators, ...hubList.emulators];
    const seen = new Set(devices.map(discoveryKey));
    for (const device of [...supplemental.ios.devices, ...supplemental.android.devices]) {
      const key = discoveryKey(device);
      if (seen.has(key)) continue;
      seen.add(key);
      devices.push(device);
    }
    const warnings = hubList.errors?.filter(
      (error) =>
        // CoreSimulator can retain deleted devices; their optional usage timestamps are absent.
        !(
          error.message.startsWith("[apple-utils] Failed to read CoreSimulator plist at ") &&
          /\/CoreSimulator\/Devices\/[^/]+\/device\.plist:$/.test(error.message) &&
          /(?:^Error:\s*ENOENT:|\bcode:\s*['"]ENOENT['"])/.test(error.error ?? "")
        ),
    );
    const details = warnings?.map((error) => error.message) ?? [];
    if (supplemental.ios.detail) details.push(supplemental.ios.detail);
    if (supplemental.android.detail) details.push(supplemental.android.detail);
    return {
      devices,
      detail: details.join("\n") || undefined,
      androidDiscoveryIncomplete: supplemental.android.detail !== undefined,
    };
  }).pipe(Effect.withSpan("DeviceHubOperations.list"));

  const boot: DeviceOperations["boot"] = Effect.fn("DeviceHubOperations.boot")(function* (device) {
    const result = yield* postJson(
      "/api/devices/boot",
      { platform: device.platform, id: device.id, name: device.name },
      "boot",
    ).pipe(Effect.flatMap((request) => hubJson(request, HubActionResult, "boot", BOOT_TIMEOUT)));
    if (!result.ok) {
      // Keep the hub's launch command and nested failure available to agents for recovery.
      const diagnostics = [
        result.error,
        ...(result.errors ?? []).flatMap((error) => [error.message, error.error]),
      ]
        .filter((text) => text?.trim())
        .join("\n\n");
      return yield* new DeviceBootError({
        hostId,
        deviceId: device.id,
        reason: /insufficient.*(?:disk|space)|not enough.*(?:disk|space)|no space left/i.test(
          diagnostics,
        )
          ? "disk_space"
          : /timed? out|timeout/i.test(diagnostics)
            ? "timeout"
            : "launch_failed",
        ...(diagnostics
          ? {
              diagnostics:
                diagnostics.length > 2_000 ? `${diagnostics.slice(0, 1_999)}…` : diagnostics,
            }
          : {}),
        cause: result,
      });
    }
    if (device.platform === "ios") yield* attachIosStream(device.id, "boot");
    return result.serial ?? result.id ?? device.id;
  });

  const attach: DeviceOperations["attach"] = (device) =>
    device.platform === "ios"
      ? attachIosStream(device.id, "open").pipe(Effect.asVoid)
      : Effect.void;

  const shutdown: DeviceOperations["shutdown"] = Effect.fn("DeviceHubOperations.shutdown")(
    function* (device) {
      const postShutdown = (path: string, body: Record<string, string>) =>
        postJson(path, body, "shutdown").pipe(
          Effect.flatMap((request) => hubJson(request, HubActionResult, "shutdown")),
          Effect.flatMap((result) =>
            result.ok
              ? Effect.void
              : Effect.fail(
                  new DeviceOperationError({
                    operation: "shutdown",
                    reason: "hub_rejected",
                    cause: result,
                  }),
                ),
          ),
        );
      // serve-sim's shutdown closes its in-process capture session before it
      // runs `simctl shutdown`; the hub's generic shutdown can leave that
      // session cached across a reboot. serve-sim runs simctl bare, though, so
      // a simulator that is already off fails there.
      yield* device.platform === "ios"
        ? postShutdown(`${vendorPrefix("ios")}/grid/api/shutdown`, { udid: device.id }).pipe(
            Effect.catch((cause) =>
              list.pipe(
                Effect.flatMap(({ devices }) =>
                  devices.find((candidate) => candidate.id === device.id)?.booted === false
                    ? Effect.logInfo("iOS simulator was already shut down", { deviceId: device.id })
                    : Effect.fail(cause),
                ),
              ),
            ),
          )
        : postShutdown("/api/devices/shutdown", { platform: device.platform, id: device.id });
    },
  );

  const screenshot: DeviceOperations["screenshot"] = (device) =>
    httpClient
      .execute(
        HttpClientRequest.post(
          `${origin}${vendorPrefix(device.platform)}/api/screenshot?device=${encodeURIComponent(device.id)}`,
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.arrayBuffer),
        Effect.map((buffer) => new Uint8Array(buffer)),
        Effect.scoped,
        Effect.timeout(SCREENSHOT_TIMEOUT),
        Effect.mapError(
          (cause) =>
            new DeviceOperationError({
              operation: "screenshot",
              reason: "request_failed",
              cause,
            }),
        ),
        Effect.withSpan("DeviceHubOperations.screenshot"),
      );

  return { list, boot, attach, shutdown, screenshot };
};
