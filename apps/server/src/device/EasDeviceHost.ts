import {
  DeviceBootError,
  type DeviceHostSummary,
  DeviceHostUnavailableError,
  DeviceOperationError,
  type DevicePlatform,
  type EasDeviceHostConfig,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Random from "effect/Random";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { writeFileStringAtomically } from "@supaterm/shared/atomicWrite";
import * as HostProcess from "@supaterm/shared/HostProcess";

import * as ServerConfig from "../config.ts";
import { releaseAgentDeviceSession } from "./AgentDeviceTarget.ts";
import * as DeviceHost from "./DeviceHost.ts";
import { findEasProjectId } from "./easProjectId.ts";
import { type ExpoApi, makeExpoApi, resolveExpoCredential } from "./ExpoApi.ts";

const POLL_INTERVAL = Duration.seconds(5);
const STATUS_TTL_MS = 15_000;
const START_TIMEOUT = Duration.minutes(15);
const PREVIEW_TIMEOUT = Duration.seconds(20);
const decodeServeSimApi = Schema.decodeUnknownEffect(
  Schema.Struct({ device: Schema.NonEmptyString }),
);
const decodeServeEmuApi = Schema.decodeUnknownEffect(
  Schema.Struct({ serial: Schema.NonEmptyString }),
);
const PLATFORMS = {
  ios: {
    name: "iPhone (Expo Simulator)",
    hubPrefix: "/vendor/serve-sim",
    previewPrefix: "",
    protocol: "serve-sim",
    remoteDeviceId: (api: unknown) => decodeServeSimApi(api).pipe(Effect.map((api) => api.device)),
  },
  android: {
    name: "Android (Expo Simulator)",
    hubPrefix: "/vendor/serve-emu",
    previewPrefix: "/vendor/serve-emu",
    protocol: "serve-emu",
    remoteDeviceId: (api: unknown) => decodeServeEmuApi(api).pipe(Effect.map((api) => api.serial)),
  },
} as const;

const CATALOG: ReadonlyArray<DeviceHost.HostDevice> = [
  {
    id: "eas-ios",
    platform: "ios",
    name: PLATFORMS.ios.name,
    version: "Cloud",
    booted: false,
    physical: false,
  },
  {
    id: "eas-android",
    platform: "android",
    name: PLATFORMS.android.name,
    version: "Cloud",
    booted: false,
    physical: false,
  },
];

interface RunningSession {
  readonly sessionId: string;
  readonly name: string;
  readonly platform: DevicePlatform;
  readonly remoteDeviceId: string;
  readonly preview: { readonly origin: string; readonly token: Redacted.Redacted<string> };
  readonly agent: DeviceHost.AgentDaemonEndpoint;
  stopping: boolean;
}

const LedgerEntry = Schema.Struct({
  name: Schema.String,
  appId: Schema.String,
  recordedAt: Schema.Number,
  refused: Schema.optional(Schema.Boolean),
});
type LedgerEntry = typeof LedgerEntry.Type;
const Ledger = Schema.fromJsonString(Schema.Array(LedgerEntry));
const decodeLedger = Schema.decodeUnknownEffect(Ledger);
const encodeLedger = Schema.encodeSync(Ledger);
const REAP_INTERVAL_MS = 60_000;
const RECORD_LIFETIME_MS = 180 * 60_000;
const RECORD_MAX_AGE_MS = 24 * 60 * 60_000;
const UNCERTAIN_CREATE_MS = 5 * 60_000;
const TRANSIENT_RETRY = { times: 3, schedule: Schedule.spaced("2 seconds") } as const;

const decodePathSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

export const make = Effect.fn("EasDeviceHost.make")(function* (config: EasDeviceHostConfig) {
  const http = yield* HttpClient.HttpClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const server = yield* ServerConfig.ServerConfig;
  const services = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | Effect.Services<ReturnType<typeof findEasProjectId>>
  >();
  const hostId = config.id;
  const ledgerPath = path.join(server.stateDir, "device", "eas", `${hostId}.json`);
  const sessions = new Map<string, RunningSession>();
  const checkedAt = new Map<string, number>();
  const startLock = yield* Semaphore.make(1);
  const ledgerLock = yield* Semaphore.make(1);
  const reapLock = yield* Semaphore.make(1);
  const starts = yield* FiberSet.make<string, unknown>();
  const background = yield* FiberSet.make<void, never>();
  const starting = new Set<string>();
  const unresolved = new Map<string, { readonly sessionId: string }>();
  const uncertain = new Map<string, { readonly entry: LedgerEntry; readonly until: number }>();
  const ownedNames = () =>
    new Set([
      ...[...sessions.values()].map((session) => session.name),
      ...starting,
      ...unresolved.keys(),
    ]);
  let epoch = 0;
  let closed = false;
  let reapedAt = 0;
  let ready: DeviceHost.DeviceHostReady | null = null;

  const unavailable = (reason: string, cause?: unknown) =>
    new DeviceHostUnavailableError({
      hostId,
      hostLabel: config.label,
      reason,
      ...(cause === undefined ? {} : { cause }),
    });

  const api: Effect.Effect<ExpoApi, DeviceHostUnavailableError> = resolveExpoCredential(
    config.accessToken,
  ).pipe(
    Effect.map((credential) => makeExpoApi(http, credential)),
    Effect.provide(services),
    Effect.mapError((error) => unavailable(error.message, error)),
  );

  const readLedger = fs.readFileString(ledgerPath).pipe(
    Effect.catchIf(
      (error) => error.reason._tag === "NotFound",
      () => Effect.succeed("[]"),
    ),
    Effect.flatMap(decodeLedger),
    Effect.mapError((cause) =>
      unavailable(
        `The record of running Expo Simulators sessions at ${ledgerPath} could not be read. Fix or remove it.`,
        cause,
      ),
    ),
  );
  const writeLedger = Effect.fn("EasDeviceHost.writeLedger")(function* (
    update: (entries: ReadonlyArray<LedgerEntry>) => ReadonlyArray<LedgerEntry>,
  ) {
    if (closed) return yield* unavailable(`${config.label} was replaced or removed.`);
    const entries = update(yield* readLedger);
    yield* writeFileStringAtomically({
      filePath: ledgerPath,
      contents: encodeLedger(entries),
    }).pipe(
      Effect.provide(services),
      Effect.mapError((cause) =>
        unavailable(
          `The record of running Expo Simulators sessions at ${ledgerPath} could not be written.`,
          cause,
        ),
      ),
    );
  }, ledgerLock.withPermit);
  const markRefused = (name: string) =>
    writeLedger((entries) =>
      entries.map((entry) => (entry.name === name ? { ...entry, refused: true } : entry)),
    ).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not update the Expo Simulators session record", { name, cause }),
      ),
    );
  const forgetEntry = (name: string) =>
    writeLedger((entries) => entries.filter((entry) => entry.name !== name)).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not update the Expo Simulators session record", { name, cause }),
      ),
    );

  const stopSession = (expo: ExpoApi, sessionId: string, name: string) =>
    expo.stop(sessionId).pipe(
      Effect.andThen(forgetEntry(name)),
      Effect.tapError((cause) =>
        Effect.logWarning("Could not stop Expo Simulators session", { sessionId, cause }),
      ),
    );

  const stopRecorded = (expo: ExpoApi, entries: ReadonlyArray<LedgerEntry>) => {
    const found = new Set<string>();
    const listed = new Set<string>();
    return Effect.forEach(
      [...new Set(entries.map((entry) => entry.appId))],
      (appId) =>
        expo.activeSessions(appId).pipe(
          Effect.flatMap((active) =>
            Effect.forEach(
              entries.filter((entry) => entry.appId === appId),
              (entry) =>
                Effect.gen(function* () {
                  const running = active.filter((session) => session.name === entry.name);
                  if (running.length > 0) {
                    found.add(entry.name);
                    return yield* Effect.forEach(
                      running,
                      (session) =>
                        stopSession(expo, session.id, entry.name).pipe(
                          Effect.catch(() =>
                            Effect.sync(
                              () => void unresolved.set(entry.name, { sessionId: session.id }),
                            ),
                          ),
                        ),
                      { discard: true },
                    );
                  }
                }),
              { discard: true },
            ),
          ),
          Effect.tap(() => Effect.sync(() => void listed.add(appId))),
          Effect.ignore,
        ),
      { discard: true, concurrency: 4 },
    ).pipe(
      Effect.as({ found, listed } as {
        readonly found: ReadonlySet<string>;
        readonly listed: ReadonlySet<string>;
      }),
    );
  };

  const retryUnresolved = (expo: ExpoApi, name: string, sessionId: string) =>
    stopSession(expo, sessionId, name).pipe(
      Effect.catch(() =>
        expo
          .session(sessionId)
          .pipe(
            Effect.flatMap((current) =>
              current.status === "STOPPED" || current.status === "ERRORED"
                ? forgetEntry(name)
                : Effect.fail(current.status),
            ),
          ),
      ),
      Effect.andThen(Effect.sync(() => void unresolved.delete(name))),
      Effect.ignore,
    );

  const adoptRecorded = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const owned = ownedNames();
    for (const entry of yield* readLedger) {
      const until = Math.max(entry.recordedAt + UNCERTAIN_CREATE_MS, now);
      if (!owned.has(entry.name) && !entry.refused) uncertain.set(entry.name, { entry, until });
    }
  }).pipe(Effect.ignore);

  const reapLeftovers = Effect.fn("EasDeviceHost.reapLeftovers")(
    function* (expo: ExpoApi) {
      if (closed) return;
      reapedAt = yield* Clock.currentTimeMillis;
      const entries = yield* readLedger;
      const owned = ownedNames();
      const leftovers = entries.filter((entry) => !owned.has(entry.name));
      const { found, listed } = yield* stopRecorded(expo, leftovers);
      for (const [name, { entry, until }] of uncertain) {
        if (found.has(name) || (reapedAt >= until && listed.has(entry.appId))) {
          uncertain.delete(name);
        }
      }
      for (const entry of leftovers) {
        const age = reapedAt - entry.recordedAt;
        if (age > RECORD_LIFETIME_MS) uncertain.delete(entry.name);
        if (found.has(entry.name)) continue;
        if ((age > RECORD_LIFETIME_MS && listed.has(entry.appId)) || age > RECORD_MAX_AGE_MS) {
          yield* forgetEntry(entry.name);
        }
      }
    },
    reapLock.withPermit,
    Effect.catch((cause) =>
      Effect.logWarning("Could not stop recorded Expo Simulators sessions", { cause }),
    ),
  );

  const previewDevice = (
    origin: string,
    token: Redacted.Redacted<string>,
    platform: DevicePlatform,
  ) =>
    http
      .execute(
        HttpClientRequest.get(`${origin}${PLATFORMS[platform].previewPrefix}/api`).pipe(
          HttpClientRequest.bearerToken(Redacted.value(token)),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.json),
        Effect.flatMap(PLATFORMS[platform].remoteDeviceId),
        Effect.scoped,
        Effect.timeout(PREVIEW_TIMEOUT),
        Effect.retry(TRANSIENT_RETRY),
      );

  const awaitRunning = Effect.fn("EasDeviceHost.awaitRunning")(
    function* (expo: ExpoApi, sessionId: string) {
      for (;;) {
        const session = yield* expo.session(sessionId).pipe(
          Effect.retry(TRANSIENT_RETRY),
          Effect.mapError((error) => unavailable(error.message, error)),
        );
        if (session.status === "STOPPED" || session.status === "ERRORED") {
          return yield* new DeviceBootError({
            hostId,
            deviceId: sessionId,
            reason: "launch_failed",
            cause: new Error(
              `Expo Simulators session ended (${session.status}) before it was ready`,
            ),
          });
        }
        if (session.status === "IN_PROGRESS" && session.endpoints) return session.endpoints;
        yield* Effect.sleep(POLL_INTERVAL);
      }
    },
    (poll, _expo, sessionId) =>
      poll.pipe(
        Effect.timeoutOrElse({
          duration: START_TIMEOUT,
          orElse: () =>
            Effect.fail(
              new DeviceBootError({
                hostId,
                deviceId: sessionId,
                reason: "timeout",
                cause: new Error("Expo Simulators session did not start in time"),
              }),
            ),
        }),
      ),
  );

  const reserveSlot = (name: string) =>
    startLock.withPermit(
      Effect.suspend(() => {
        const pending = unresolved.size + uncertain.size;
        if (sessions.size + starting.size + pending >= config.maxConcurrentSessions) {
          const limit = `${config.label} is limited to ${config.maxConcurrentSessions} running ${config.maxConcurrentSessions === 1 ? "session" : "sessions"}.`;
          return Effect.fail(
            unavailable(
              pending > 0
                ? `${limit} ${pending === 1 ? "A session" : `${pending} sessions`} that failed to start or stop ${pending === 1 ? "is" : "are"} still being cleaned up; try again shortly.`
                : `${limit} Close one in the Device panel first.`,
            ),
          );
        }
        starting.add(name);
        return Effect.void;
      }),
    );

  const startSession = Effect.fn("EasDeviceHost.startSession")(function* (
    device: DeviceHost.HostDevice,
    context: DeviceHost.DeviceOpenContext | undefined,
    startedIn: number,
  ) {
    const name = `Supaterm · ${config.label} · ${(yield* Random.nextIntBetween(0, 0xffffff)).toString(16).padStart(6, "0")}`;
    const expo = yield* api;
    return yield* Effect.acquireUseRelease(
      reserveSlot(name),
      () =>
        Effect.gen(function* () {
          const appId =
            config.appId ??
            Option.getOrUndefined(
              context?.workspaceRoot
                ? yield* findEasProjectId(context.workspaceRoot).pipe(Effect.provide(services))
                : Option.none<string>(),
            );
          if (!appId) {
            return yield* unavailable(
              "No Expo project to run the session under. Choose one for this host in Settings, or open the device from a thread whose project names extra.eas.projectId in app.json or its app config.",
            );
          }
          const entry = { name, appId, recordedAt: yield* Clock.currentTimeMillis };
          yield* writeLedger((entries) => [...entries, entry]);
          if (epoch !== startedIn) {
            yield* forgetEntry(name);
            return yield* unavailable(`${config.label} was stopped while the session started.`);
          }
          return yield* Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const sessionId = yield* expo
                .create({
                  appId,
                  platform: device.platform,
                  name,
                  maxRunTimeMinutes: config.maxSessionMinutes,
                  maxIdleTimeMinutes: config.idleMinutes,
                })
                .pipe(
                  Effect.tapError((error) =>
                    error.rejected
                      ? stopRecorded(expo, [entry]).pipe(
                          Effect.flatMap(({ found }) =>
                            found.has(name) ? Effect.void : markRefused(name),
                          ),
                        )
                      : stopRecorded(expo, [entry]).pipe(
                          Effect.flatMap(({ found }) =>
                            found.has(name)
                              ? Effect.void
                              : Effect.map(Clock.currentTimeMillis, (now) => {
                                  uncertain.set(name, {
                                    entry,
                                    until: now + UNCERTAIN_CREATE_MS,
                                  });
                                }),
                          ),
                        ),
                  ),
                  Effect.mapError((error) => unavailable(error.message, error)),
                );
              return yield* restore(
                trackSession(expo, sessionId, name, device.platform, startedIn),
              ).pipe(
                Effect.onError(() =>
                  stopSession(expo, sessionId, name).pipe(
                    Effect.catch(() => Effect.sync(() => void unresolved.set(name, { sessionId }))),
                  ),
                ),
              );
            }),
          );
        }),
      () => Effect.sync(() => void starting.delete(name)),
    );
  });

  const trackSession = Effect.fn("EasDeviceHost.trackSession")(function* (
    expo: ExpoApi,
    sessionId: string,
    name: string,
    platform: DevicePlatform,
    startedIn: number,
  ) {
    const endpoints = yield* awaitRunning(expo, sessionId);
    if (!endpoints.preview) {
      return yield* new DeviceBootError({
        hostId,
        deviceId: sessionId,
        reason: "launch_failed",
        cause: new Error("Expo Simulators returned no preview endpoint"),
      });
    }
    const origin = new URL(endpoints.preview.url).origin;
    const remoteDeviceId = yield* previewDevice(origin, endpoints.preview.token, platform).pipe(
      Effect.mapError(
        (cause) =>
          new DeviceBootError({
            hostId,
            deviceId: sessionId,
            reason: "launch_failed",
            cause,
          }),
      ),
    );
    if (epoch !== startedIn) {
      return yield* unavailable(`${config.label} was stopped while the session started.`);
    }
    sessions.set(sessionId, {
      sessionId,
      name,
      platform,
      remoteDeviceId,
      preview: { origin, token: endpoints.preview.token },
      agent: {
        baseUrl: endpoints.agentDevice.url,
        token: Redacted.value(endpoints.agentDevice.token),
      },
      stopping: false,
    });
    return sessionId;
  });

  const sessionFor = (deviceId: string) => Option.fromNullishOr(sessions.get(deviceId));

  const forget = (session: RunningSession) =>
    Effect.sync(() => {
      sessions.delete(session.sessionId);
      checkedAt.delete(session.sessionId);
    });

  const dropEnded = Effect.gen(function* () {
    if (closed) return;
    const now = yield* Clock.currentTimeMillis;
    const stale = [...sessions.values()].filter(
      (session) =>
        session.stopping || now - (checkedAt.get(session.sessionId) ?? 0) > STATUS_TTL_MS,
    );
    const reapDue = now - reapedAt > REAP_INTERVAL_MS;
    if (stale.length === 0 && unresolved.size === 0 && uncertain.size === 0 && !reapDue) return;
    const reap = reapDue || uncertain.size > 0;
    if (reap) reapedAt = now;
    const expo = yield* api.pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          for (const [name, { until }] of uncertain) if (now >= until) uncertain.delete(name);
        }),
      ),
    );
    yield* Effect.forEach(
      [...unresolved],
      ([name, { sessionId }]) => retryUnresolved(expo, name, sessionId),
      { discard: true, concurrency: 4 },
    );
    yield* Effect.forEach(
      stale,
      (session) =>
        (session.stopping
          ? stopSession(expo, session.sessionId, session.name).pipe(
              Effect.andThen(forget(session)),
              Effect.catch(() =>
                expo
                  .session(session.sessionId)
                  .pipe(
                    Effect.flatMap((current) =>
                      current.status === "STOPPED" || current.status === "ERRORED"
                        ? forget(session).pipe(Effect.andThen(forgetEntry(session.name)))
                        : Effect.fail(current.status),
                    ),
                  ),
              ),
            )
          : expo
              .session(session.sessionId)
              .pipe(
                Effect.flatMap((current) =>
                  current.status === "STOPPED" || current.status === "ERRORED"
                    ? forget(session).pipe(Effect.andThen(forgetEntry(session.name)))
                    : Effect.sync(() => void checkedAt.set(session.sessionId, now)),
                ),
              )
        ).pipe(Effect.ignore),
      { discard: true, concurrency: 4 },
    );
    if (reap) yield* reapLeftovers(expo);
  }).pipe(Effect.ignore);

  const stopTracked = (expo: ExpoApi, session: RunningSession) =>
    Effect.suspend(() => {
      session.stopping = true;
      return stopSession(expo, session.sessionId, session.name);
    }).pipe(Effect.andThen(forget(session)));

  const devices: DeviceHost.DeviceOperations = {
    list: dropEnded.pipe(
      Effect.andThen(
        Effect.sync(() => ({
          devices: [
            ...CATALOG,
            ...[...sessions.values()].map((session) => ({
              id: session.sessionId,
              platform: session.platform,
              name: PLATFORMS[session.platform].name,
              version: "Cloud",
              booted: true,
              physical: false,
            })),
          ],
          detail: undefined,
        })),
      ),
    ),
    boot: (device, context) => {
      if (sessions.has(device.id)) return Effect.succeed(device.id);
      const startedIn = epoch;
      return startSession(device, context, startedIn).pipe(
        FiberSet.run(starts),
        Effect.flatMap(Fiber.await),
        Effect.flatMap((exit) =>
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
            ? Effect.fail(unavailable(`${config.label} was stopped while the session started.`))
            : exit,
        ),
      );
    },
    attach: () => Effect.void,
    shutdown: (device) =>
      Option.match(sessionFor(device.id), {
        onNone: () => Effect.void,
        onSome: (session) =>
          api.pipe(
            Effect.flatMap((expo) => stopTracked(expo, session)),
            Effect.asVoid,
            Effect.mapError(
              (cause) =>
                new DeviceOperationError({
                  operation: "shutdown",
                  reason: "request_failed",
                  cause,
                }),
            ),
          ),
      }),
    screenshot: (device) =>
      Option.match(sessionFor(device.id), {
        onNone: () =>
          Effect.fail(
            new DeviceOperationError({
              operation: "screenshot",
              reason: "request_failed",
              cause: new Error("The Expo Simulator is not running"),
            }),
          ),
        onSome: (session) =>
          http
            .execute(
              HttpClientRequest.post(
                `${session.preview.origin}${PLATFORMS[session.platform].previewPrefix}/api/screenshot?device=${encodeURIComponent(session.remoteDeviceId)}`,
              ).pipe(HttpClientRequest.bearerToken(Redacted.value(session.preview.token))),
            )
            .pipe(
              Effect.flatMap(HttpClientResponse.filterStatusOk),
              Effect.flatMap((response) => response.arrayBuffer),
              Effect.map((buffer) => new Uint8Array(buffer)),
              Effect.scoped,
              Effect.timeout(PREVIEW_TIMEOUT),
              Effect.mapError(
                (cause) =>
                  new DeviceOperationError({
                    operation: "screenshot",
                    reason: "request_failed",
                    cause,
                  }),
              ),
            ),
      }),
    agentEndpoint: (deviceId) =>
      Option.match(sessionFor(deviceId), {
        onNone: () => Effect.fail(unavailable("This Expo Simulator is no longer running.")),
        onSome: (session) =>
          Effect.succeed({ ...session.agent, agentDeviceId: session.remoteDeviceId }),
      }),
    endsDevices: true,
  };

  const upstream: NonNullable<DeviceHost.DeviceHostReady["upstream"]> = (hubPath, search) =>
    Effect.sync(() => {
      const platform = (["ios", "android"] as const).find((candidate) =>
        hubPath.startsWith(`${PLATFORMS[candidate].hubPrefix}/`),
      );
      if (!platform) return null;
      const helper = /^\/vendor\/serve-sim\/helper\/([^/]+)\//.exec(hubPath);
      const deviceId = helper ? decodePathSegment(helper[1]!) : search.get("device");
      if (helper && deviceId === null) return null;
      const session =
        deviceId !== null
          ? sessions.get(deviceId)
          : sessions.size === 1
            ? [...sessions.values()][0]
            : undefined;
      if (session?.platform !== platform) return null;
      const { hubPrefix, previewPrefix, protocol } = PLATFORMS[platform];
      const path = helper
        ? `/helper/${encodeURIComponent(session.remoteDeviceId)}${hubPath.slice(helper[0].length - 1)}`
        : `${previewPrefix}${hubPath.slice(hubPrefix.length)}`;
      const params = new URLSearchParams(search);
      if (params.has("device")) params.set("device", session.remoteDeviceId);
      const query = params.size > 0 ? `?${params.toString()}` : "";
      const token = Redacted.value(session.preview.token);
      return {
        url: `${session.preview.origin}${path}${query}`,
        headers: { authorization: `Bearer ${token}` },
        protocols: [`${protocol}.token.${token}`],
      };
    });

  const nodePath = yield* HostProcess.ExecutablePath;
  const ensureReady: DeviceHost.DeviceHost["Service"]["ensureReady"] = Effect.fn(
    "EasDeviceHost.ensureReady",
  )(function* () {
    if (ready) return ready;
    yield* adoptRecorded;
    yield* FiberSet.run(background)(api.pipe(Effect.flatMap(reapLeftovers), Effect.ignore));
    ready = {
      nodePath,
      hub: { origin: "https://api.expo.dev" },
      devices,
      upstream,
      releaseAgentSession: (session, deviceId) =>
        Option.match(sessionFor(deviceId), {
          onNone: () => Effect.void,
          onSome: (running) => releaseAgentDeviceSession(http, running.agent)(session),
        }),
      run: () =>
        Effect.succeed({
          stdout: "",
          stderr: "Devices from Expo Simulators cannot run host commands.",
          code: 127,
        }),
      helpers: { serveSimAxSettings: null, serveSimCli: null },
    };
    return ready;
  });

  const stopAll = Effect.gen(function* () {
    epoch++;
    yield* FiberSet.clear(starts);
    yield* FiberSet.clear(background);
    const expo = yield* api;
    yield* Effect.forEach(
      [...sessions.values()],
      (session) => stopTracked(expo, session).pipe(Effect.ignore),
      { discard: true, concurrency: 4 },
    );
    yield* Effect.forEach(
      [...unresolved],
      ([name, { sessionId }]) => retryUnresolved(expo, name, sessionId),
      { discard: true, concurrency: 4 },
    );
    yield* reapLeftovers(expo);
  }).pipe(Effect.ignore);
  yield* Effect.addFinalizer(() =>
    stopAll.pipe(
      Effect.andThen(
        ledgerLock.withPermit(
          Effect.sync(() => {
            closed = true;
          }),
        ),
      ),
    ),
  );

  const platformAvailability = (platform: DevicePlatform) =>
    resolveExpoCredential(config.accessToken).pipe(
      Effect.provide(services),
      Effect.as({ platform, available: true }),
      Effect.catch((error) =>
        Effect.succeed({ platform, available: false, reason: error.message }),
      ),
    );

  const summary: Effect.Effect<DeviceHostSummary> = Effect.all([
    platformAvailability("ios"),
    platformAvailability("android"),
  ]).pipe(
    Effect.map((platforms) => ({
      id: hostId,
      label: config.label,
      kind: "eas" as const,
      platforms,
      hubInstalled: true,
      agentDeviceInstalled: true,
    })),
  );

  return DeviceHost.DeviceHost.of({
    id: hostId,
    label: config.label,
    summary,
    platformAvailability,
    ensureReady,
    ensureAgentReady: Effect.fn("DeviceHost.ensureAgentReady")(function (onPhase) {
      return ensureReady(onPhase).pipe(Effect.map((value) => ({ ...value, agentDevice: null })));
    }),
    current: Effect.sync(() => ready),
    stopAgent: Effect.void,
    stop: stopAll,
  });
});
