import {
  isTailnetCallerAdmitted,
  TailnetActionError,
  type TailnetLoginResult,
  type TailnetOwner,
  type TailnetSettings,
  type TailnetStatus,
  tailnetHostname,
} from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Ndjson from "effect/encoding/Ndjson";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import {
  SidecarCommand,
  SidecarEvent,
  type SidecarStatus,
  TAILNET_PROTOCOL_VERSION,
} from "./protocol.ts";
import * as TailnetBinary from "./TailnetBinary.ts";
import { TailnetIngress } from "./TailnetIngress.ts";
import type { TailnetPeer } from "./tailnetPeer.ts";

const LOGIN_TIMEOUT = Duration.seconds(30);
const LOGOUT_TIMEOUT = Duration.seconds(20);
const MAX_RESTART_DELAY_MS = 60_000;

const ENVIRONMENT_ALLOWLIST = [
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "WINDIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

function sidecarEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    ENVIRONMENT_ALLOWLIST.flatMap((name) => {
      const value = environment[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

interface RunConfig {
  readonly hostname: string;
  readonly controlUrl: string;
}

interface NodeState {
  readonly status: TailnetStatus;
  readonly loginUrl: string | null;
  readonly seq: number;
}

function restartDelayMs(attempt: number): number {
  return Math.min(MAX_RESTART_DELAY_MS, 1_000 * 2 ** attempt);
}

function nodeStateFromSidecar(status: SidecarStatus, previous: NodeState): NodeState {
  const seq = previous.seq + 1;
  switch (status.state) {
    case "starting":
      return { status: { state: "starting" }, loginUrl: null, seq };
    case "needs-login":
      return {
        status: { state: "needs-login", loginReady: status.loginUrl !== null },
        loginUrl: status.loginUrl,
        seq,
      };
    case "needs-approval":
      return { status: { state: "needs-approval" }, loginUrl: null, seq };
    case "running":
      return { status, loginUrl: null, seq };
    case "stopped":
      return previous;
  }
}

function runConfigOf(settings: TailnetSettings, machineHostname: string): RunConfig | undefined {
  return settings.enabled
    ? { hostname: tailnetHostname(settings, machineHostname), controlUrl: settings.controlUrl }
    : undefined;
}

class SidecarExited extends Schema.TaggedError<SidecarExited>()("SidecarExited", {
  message: Schema.String,
}) {}

export class TailnetNode extends Context.Service<
  TailnetNode,
  {
    readonly start: Effect.Effect<void, never, Scope.Scope>;
    readonly current: Effect.Effect<TailnetStatus>;
    readonly changes: Stream.Stream<TailnetStatus>;
    readonly owner: Effect.Effect<TailnetOwner | null>;
    readonly login: Effect.Effect<TailnetLoginResult, TailnetActionError>;
    readonly logout: Effect.Effect<void, TailnetActionError>;
  }
>()("supaterm/tailnet/TailnetNode") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettingsService.ServerSettingsService;
  const binary = yield* TailnetBinary.TailnetBinary;
  const ingress = yield* TailnetIngress;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* HostProcess.Environment;
  const platform = yield* HostProcess.Platform;
  const machineHostname = yield* HostProcess.Hostname;
  const stateDir = path.join(config.stateDir, "tailscale");
  const verbose = environment.SUPATERM_TAILNET_VERBOSE === "1";

  const state = yield* SubscriptionRef.make<NodeState>({
    status: { state: "off" },
    loginUrl: null,
    seq: 0,
  });
  const send = yield* Ref.make<
    Option.Option<(command: SidecarCommand) => Effect.Effect<void, TailnetActionError>>
  >(Option.none());
  const lastError = yield* Ref.make<string | null>(null);
  const disconnect = yield* Ref.make<
    Option.Option<(refused: (peer: TailnetPeer) => boolean) => void>
  >(Option.none());
  const lock = yield* Semaphore.make(1);
  let running: { readonly config: RunConfig; readonly fiber: Fiber.Fiber<void> } | undefined;

  const setStatus = (status: TailnetStatus) =>
    SubscriptionRef.update(state, (previous) => ({
      status,
      loginUrl: null,
      seq: previous.seq + 1,
    }));

  const ownerOf = SubscriptionRef.get(state).pipe(
    Effect.map((value) => (value.status.state === "running" ? value.status.owner : null)),
  );

  const encodeCommand = Schema.encodeEffect(Schema.fromJsonString(SidecarCommand));
  const decodeEvent = Schema.decodeUnknownEffect(SidecarEvent);

  const prepareStateDir = Effect.gen(function* () {
    yield* fileSystem.makeDirectory(stateDir, { recursive: true });
    if (platform !== "win32") yield* fileSystem.chmod(stateDir, 0o700);
  });

  const runOnce = Effect.fn("TailnetNode.runOnce")(function* (
    runConfig: RunConfig,
    executable: string,
    onRunning: Effect.Effect<void>,
  ) {
    yield* prepareStateDir.pipe(
      Effect.mapError((cause) => new SidecarExited({ message: String(cause) })),
    );
    const endpoint = yield* ingress.open.pipe(
      Effect.mapError(() => new SidecarExited({ message: "The tailnet ingress could not open." })),
    );
    yield* Effect.acquireRelease(Ref.set(disconnect, Option.some(endpoint.disconnect)), () =>
      Ref.set(disconnect, Option.none()),
    );
    const handle = yield* Effect.acquireRelease(
      spawner.spawn(
        ChildProcess.make(executable, [], {
          cwd: stateDir,
          env: { ...sidecarEnvironment(environment), XDG_DATA_HOME: stateDir },
          stdin: { stream: "pipe", endOnDone: false },
          stdout: "pipe",
          stderr: "pipe",
          killSignal: "SIGTERM",
          forceKillAfter: Duration.seconds(3),
        }),
      ),
      (child) => child.kill().pipe(Effect.ignore),
    ).pipe(
      Effect.mapError(
        () => new SidecarExited({ message: "The Tailscale helper could not start." }),
      ),
    );
    const writeLock = yield* Semaphore.make(1);
    const write = (command: SidecarCommand) =>
      encodeCommand(command).pipe(
        Effect.flatMap((line) =>
          Stream.run(Stream.encodeText(Stream.make(`${line}\n`)), handle.stdin),
        ),
        Effect.mapError((cause) => new TailnetActionError({ reason: "failed", cause })),
        writeLock.withPermit,
      );
    yield* Effect.acquireRelease(Ref.set(send, Option.some(write)), () =>
      Ref.set(send, Option.none()),
    );
    yield* handle.stderr.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) =>
        verbose ? Effect.logDebug("Tailscale helper", { line }) : Effect.void,
      ),
      Effect.ignore,
      Effect.forkScoped,
    );

    const handleEvent = (event: SidecarEvent) => {
      switch (event.type) {
        case "hello":
          return write({
            version: TAILNET_PROTOCOL_VERSION,
            type: "start",
            stateDir,
            hostname: runConfig.hostname,
            controlUrl: runConfig.controlUrl === "" ? null : runConfig.controlUrl,
            authKey: null,
            advertiseTags: [],
            ingressAddress: endpoint.address,
            ingressSecret: endpoint.secret,
            verbose,
          }).pipe(Effect.ignore);
        case "status":
          return SubscriptionRef.update(state, (previous) =>
            nodeStateFromSidecar(event.status, previous),
          ).pipe(Effect.andThen(event.status.state === "running" ? onRunning : Effect.void));
        case "error":
          return Ref.set(lastError, event.message).pipe(
            Effect.andThen(
              Effect.logWarning("Tailscale helper reported a problem", {
                code: event.code,
                message: event.message,
              }),
            ),
          );
      }
    };

    const events = handle.stdout.pipe(
      Stream.pipeThroughChannel(Ndjson.decode({ ignoreEmptyLines: true })),
      Stream.mapEffect((value) => decodeEvent(value)),
      Stream.runForEach(handleEvent),
      Effect.mapError(
        () => new SidecarExited({ message: "The Tailscale helper sent an unreadable message." }),
      ),
    );
    const exited = handle.exitCode.pipe(
      Effect.mapError(() => new SidecarExited({ message: "The Tailscale helper stopped." })),
      Effect.flatMap((code) =>
        Ref.get(lastError).pipe(
          Effect.flatMap((message) =>
            Effect.fail(
              new SidecarExited({
                message: message ?? `The Tailscale helper exited with code ${Number(code)}.`,
              }),
            ),
          ),
        ),
      ),
    );
    return yield* Effect.raceFirst(
      events.pipe(
        Effect.andThen(
          Effect.fail(new SidecarExited({ message: "The Tailscale helper stopped." })),
        ),
      ),
      exited,
    );
  }, Effect.scoped);

  const supervise = Effect.fn("TailnetNode.supervise")(function* (runConfig: RunConfig) {
    let attempt = 0;
    while (true) {
      const resolution = yield* binary.resolve;
      if (resolution._tag !== "Found") {
        yield* setStatus({
          state: "unavailable",
          reason: resolution._tag === "Missing" ? "binary-missing" : "unsupported-platform",
        });
        return yield* Effect.never;
      }
      yield* Ref.set(lastError, null);
      yield* setStatus({ state: "starting" });
      const failure = yield* runOnce(
        runConfig,
        resolution.path,
        Effect.sync(() => {
          attempt = 0;
        }),
      ).pipe(Effect.flip);
      const delay = restartDelayMs(attempt);
      attempt += 1;
      const now = yield* DateTime.now;
      yield* Effect.logWarning("Built-in Tailscale stopped; restarting", {
        message: failure.message,
        delayMs: delay,
      });
      yield* setStatus({
        state: "crashed",
        message: failure.message,
        retryAt: now.epochMilliseconds + delay,
      });
      yield* Effect.sleep(Duration.millis(delay));
    }
  });

  const stopRunning = Effect.gen(function* () {
    const previous = running;
    running = undefined;
    if (previous !== undefined) yield* Fiber.interrupt(previous.fiber);
  });

  const reconcile = Effect.fn("TailnetNode.reconcile")(function* (
    value: TailnetSettings,
    scope: Scope.Scope,
  ) {
    const desired = runConfigOf(value, machineHostname);
    if (
      running !== undefined &&
      desired !== undefined &&
      running.config.hostname === desired.hostname &&
      running.config.controlUrl === desired.controlUrl
    ) {
      const owner = yield* ownerOf;
      const drop = yield* Ref.get(disconnect);
      if (Option.isSome(drop)) {
        drop.value(
          (peer) =>
            !isTailnetCallerAdmitted({
              settings: value,
              owner,
              callerLogin: peer.identity?.login ?? null,
            }),
        );
      }
      return;
    }
    yield* stopRunning;
    if (desired === undefined) return yield* setStatus({ state: "off" });
    running = {
      config: desired,
      fiber: yield* supervise(desired).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logError("Built-in Tailscale supervisor failed", { cause }),
        ),
        Effect.forkIn(scope),
      ),
    };
  }, lock.withPermit);

  let started = false;
  const start = Effect.gen(function* () {
    if (started) return;
    started = true;
    const scope = yield* Effect.scope;
    yield* Effect.addFinalizer(() =>
      stopRunning.pipe(Effect.andThen(setStatus({ state: "off" })), lock.withPermit),
    );
    const changes = yield* settings.subscribeChanges;
    const initial = yield* settings.getSettings.pipe(Effect.option);
    if (Option.isSome(initial)) yield* reconcile(initial.value.tailnet, scope);
    yield* changes.pipe(
      Stream.map((value) => value.tailnet),
      Stream.changesWith<TailnetSettings>(Equal.equals),
      Stream.runForEach((value) => reconcile(value, scope)),
      Effect.forkScoped,
    );
  });

  const changes = SubscriptionRef.changes(state).pipe(
    Stream.map((value) => value.status),
    Stream.changesWith<TailnetStatus>(Equal.equals),
  );

  const failFor = (status: TailnetStatus) =>
    status.state === "off"
      ? new TailnetActionError({ reason: "off" })
      : status.state === "unavailable"
        ? new TailnetActionError({ reason: "unavailable" })
        : status.state === "running"
          ? new TailnetActionError({ reason: "signed-in" })
          : new TailnetActionError({ reason: "failed" });

  const commandFor = (status: TailnetStatus) =>
    Ref.get(send).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(failFor(status)),
          onSome: Effect.succeed,
        }),
      ),
    );

  const replyAfter = (
    seq: number,
    timeout: Duration.Input,
    pending: (status: TailnetStatus) => boolean,
  ) =>
    SubscriptionRef.changes(state).pipe(
      Stream.filter((value) => value.seq > seq && !pending(value.status)),
      Stream.runHead,
      Effect.timeoutOption(timeout),
      Effect.map(Option.flatten),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new TailnetActionError({ reason: "timeout" })),
          onSome: Effect.succeed,
        }),
      ),
    );

  const login = Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(state);
    if (
      current.status.state === "off" ||
      current.status.state === "unavailable" ||
      current.status.state === "running"
    ) {
      return yield* failFor(current.status);
    }
    const write = yield* commandFor(current.status);
    yield* write({ version: TAILNET_PROTOCOL_VERSION, type: "login" });
    const reply = yield* replyAfter(
      current.seq,
      LOGIN_TIMEOUT,
      (status) =>
        status.state === "starting" || (status.state === "needs-login" && !status.loginReady),
    );
    if (reply.loginUrl === null) return yield* failFor(reply.status);
    return { loginUrl: reply.loginUrl };
  }).pipe(Effect.withSpan("TailnetNode.login"));

  const logout = Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(state);
    if (current.status.state === "off" || current.status.state === "unavailable") {
      return yield* failFor(current.status);
    }
    const write = yield* commandFor(current.status);
    yield* write({ version: TAILNET_PROTOCOL_VERSION, type: "logout" });
    if (current.status.state !== "running" && current.status.state !== "needs-approval") return;
    const reply = yield* replyAfter(
      current.seq,
      LOGOUT_TIMEOUT,
      (status) =>
        status.state === "starting" ||
        status.state === "running" ||
        status.state === "needs-approval",
    );
    if (reply.status.state !== "needs-login") {
      return yield* new TailnetActionError({ reason: "failed" });
    }
  }).pipe(Effect.withSpan("TailnetNode.logout"));

  return TailnetNode.of({
    start,
    current: SubscriptionRef.get(state).pipe(Effect.map((value) => value.status)),
    changes,
    owner: ownerOf,
    login,
    logout,
  });
});

export const layer = Layer.effect(TailnetNode, make).pipe(Layer.provide(TailnetBinary.layer));

export const layerStatic = (status: TailnetStatus) =>
  Layer.succeed(
    TailnetNode,
    TailnetNode.of({
      start: Effect.void,
      current: Effect.succeed(status),
      changes: Stream.concat(Stream.make(status), Stream.never),
      owner: Effect.succeed(status.state === "running" ? status.owner : null),
      login: Effect.fail(new TailnetActionError({ reason: "off" })),
      logout: Effect.fail(new TailnetActionError({ reason: "off" })),
    }),
  );

export const layerOff = layerStatic({ state: "off" });
