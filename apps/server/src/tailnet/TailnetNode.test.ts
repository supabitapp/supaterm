import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  type ManagedPolicyDocument,
  type ServerSettings,
  type TailnetSettings,
  type TailnetStatus,
} from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";
import { expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import type { SidecarCommand, SidecarEvent } from "./protocol.ts";
import * as TailnetBinary from "./TailnetBinary.ts";
import { TailnetIngress } from "./TailnetIngress.ts";
import * as TailnetNode from "./TailnetNode.ts";

interface FakeProcess {
  readonly env: Record<string, unknown> | undefined;
  readonly stdout: Queue.Queue<Uint8Array>;
  readonly commands: Queue.Queue<SidecarCommand>;
  readonly exit: Deferred.Deferred<number>;
  readonly killed: Deferred.Deferred<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const emit = (process: FakeProcess, event: SidecarEvent) =>
  Queue.offer(process.stdout, encoder.encode(`${JSON.stringify(event)}\n`));

const running: Extract<TailnetStatus, { state: "running" }> = {
  state: "running",
  dnsName: "supaterm-mac-mini.tail1234.ts.net",
  addresses: ["100.101.102.103"],
  owner: { type: "user", login: "alice@example.com", displayName: "Alice" },
  https: "ready",
  keyExpiry: null,
  health: [],
};

const settingsWith = (tailnet: Partial<TailnetSettings>): ServerSettings => ({
  ...DEFAULT_SERVER_SETTINGS,
  tailnet: { ...DEFAULT_SERVER_SETTINGS.tailnet, ...tailnet },
});

const setup = Effect.fn(function* (options: {
  readonly tailnet: Partial<TailnetSettings>;
  readonly binary?: TailnetBinary.TailnetBinaryResolution;
  readonly policy?: ManagedPolicyDocument;
}) {
  const settings = yield* SubscriptionRef.make(settingsWith(options.tailnet));
  const spawned = yield* Queue.unbounded<FakeProcess>();
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      const process: FakeProcess = {
        env: (
          command as unknown as { readonly options: { readonly env?: Record<string, unknown> } }
        ).options.env,
        stdout: yield* Queue.unbounded<Uint8Array>(),
        commands: yield* Queue.unbounded<SidecarCommand>(),
        exit: yield* Deferred.make<number>(),
        killed: yield* Deferred.make<void>(),
      };
      yield* Queue.offer(spawned, process);
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        stdout: Stream.fromQueue(process.stdout),
        stderr: Stream.empty,
        all: Stream.empty,
        exitCode: Deferred.await(process.exit).pipe(Effect.map(ChildProcessSpawner.ExitCode)),
        isRunning: Effect.succeed(true),
        kill: () => Deferred.succeed(process.killed, undefined).pipe(Effect.asVoid),
        stdin: Sink.forEach((chunk: Uint8Array) =>
          Queue.offer(process.commands, JSON.parse(decoder.decode(chunk)) as SidecarCommand),
        ),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
    }),
  );
  const node = yield* TailnetNode.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ServerSettingsService.ServerSettingsService)({
          getSettings: SubscriptionRef.get(settings),
          subscribeChanges: Effect.succeed(SubscriptionRef.changes(settings)),
        }),
        Layer.succeed(TailnetBinary.TailnetBinary, {
          resolve: Effect.succeed<TailnetBinary.TailnetBinaryResolution>(
            options.binary ?? { _tag: "Found", path: "/bin/supaterm-tailnet" },
          ),
        }),
        Layer.succeed(TailnetIngress, {
          open: Effect.succeed({
            address: "127.0.0.1:4000",
            secret: "ingress-secret",
            disconnect: () => undefined,
          }),
        }),
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ServerConfig.layerTest(process.cwd(), { prefix: "supaterm-tailnet-" }),
        ManagedPolicy.layerTest(options.policy),
      ),
    ),
    Effect.provideService(HostProcess.Hostname, "Mac-Mini.local"),
    Effect.provideService(HostProcess.Environment, {
      HOME: "/home/alice",
      PATH: "/usr/bin",
      TS_AUTHKEY: "tskey-leaked",
      HTTPS_PROXY: "http://proxy:3128",
    }),
  );
  const waitFor = (predicate: (status: TailnetStatus) => boolean) =>
    node.changes.pipe(Stream.filter(predicate), Stream.runHead);
  return {
    node,
    spawned,
    waitFor,
    setTailnet: (tailnet: Partial<TailnetSettings>) =>
      SubscriptionRef.set(settings, settingsWith(tailnet)),
  };
});

it.layer(NodeServices.layer)("TailnetNode", (it) => {
  it.effect("drives the helper through sign-in, sign-out, a crash and turning off", () =>
    Effect.gen(function* () {
      const { node, spawned, waitFor, setTailnet } = yield* setup({ tailnet: { enabled: true } });
      yield* node.start;
      const first = yield* Queue.take(spawned);
      const { XDG_DATA_HOME, ...inherited } = first.env ?? {};
      expect(inherited).toEqual({ HOME: "/home/alice", HTTPS_PROXY: "http://proxy:3128" });
      expect(XDG_DATA_HOME).toMatch(/[/\\]tailscale$/);

      yield* emit(first, { version: 1, type: "hello", tailscaleVersion: "1.106.0" });
      expect(yield* Queue.take(first.commands)).toMatchObject({
        type: "start",
        hostname: "supaterm-mac-mini",
        controlUrl: null,
        authKey: null,
        ingressAddress: "127.0.0.1:4000",
        ingressSecret: "ingress-secret",
      });

      yield* emit(first, {
        version: 1,
        type: "status",
        status: { state: "needs-login", loginUrl: "https://login.tailscale.com/a/abc" },
      });
      yield* waitFor((status) => status.state === "needs-login");
      expect(yield* node.current).toEqual({ state: "needs-login", loginReady: true });
      const signingIn = yield* Effect.forkScoped(node.login);
      expect(yield* Queue.take(first.commands)).toMatchObject({ type: "login" });
      yield* emit(first, { version: 1, type: "status", status: { state: "starting" } });
      yield* emit(first, {
        version: 1,
        type: "status",
        status: { state: "needs-login", loginUrl: null },
      });
      yield* emit(first, {
        version: 1,
        type: "status",
        status: { state: "needs-login", loginUrl: "https://login.tailscale.com/a/fresh" },
      });
      expect(yield* Fiber.join(signingIn)).toEqual({
        loginUrl: "https://login.tailscale.com/a/fresh",
      });

      yield* emit(first, { version: 1, type: "status", status: running });
      yield* waitFor((status) => status.state === "running");
      expect(yield* node.owner).toEqual(running.owner);
      expect(yield* node.login.pipe(Effect.flip)).toMatchObject({ reason: "signed-in" });

      const loggingOut = yield* Effect.forkScoped(node.logout);
      expect(yield* Queue.take(first.commands)).toMatchObject({ type: "logout" });
      yield* emit(first, {
        version: 1,
        type: "status",
        status: { state: "needs-login", loginUrl: null },
      });
      yield* Fiber.join(loggingOut);
      expect(yield* node.current).toEqual({ state: "needs-login", loginReady: false });

      yield* Deferred.succeed(first.exit, 1);
      const crashed = yield* waitFor((status) => status.state === "crashed");
      expect(crashed).toMatchObject({ _tag: "Some", value: { state: "crashed" } });
      yield* TestClock.adjust("1 second");
      const second = yield* Queue.take(spawned);

      yield* setTailnet({ enabled: false });
      yield* waitFor((status) => status.state === "off");
      yield* Deferred.await(second.killed);
    }),
  );

  it.effect("fails sign-out when the helper exits instead of signing out", () =>
    Effect.gen(function* () {
      const { node, spawned, waitFor } = yield* setup({ tailnet: { enabled: true } });
      yield* node.start;
      const helper = yield* Queue.take(spawned);
      yield* emit(helper, { version: 1, type: "status", status: running });
      yield* waitFor((status) => status.state === "running");
      const signingOut = yield* Effect.forkScoped(node.logout);
      expect(yield* Queue.take(helper.commands)).toMatchObject({ type: "logout" });
      yield* Deferred.succeed(helper.exit, 1);
      expect(yield* Fiber.join(signingOut).pipe(Effect.flip)).toMatchObject({ reason: "failed" });
    }),
  );

  it.effect("restarts the helper under a new name when the machine name changes", () =>
    Effect.gen(function* () {
      const { node, spawned, setTailnet } = yield* setup({ tailnet: { enabled: true } });
      yield* node.start;
      const first = yield* Queue.take(spawned);
      yield* setTailnet({ enabled: true, hostname: "studio" });
      yield* Deferred.await(first.killed);
      const second = yield* Queue.take(spawned);
      yield* emit(second, { version: 1, type: "hello", tailscaleVersion: "1.106.0" });
      expect(yield* Queue.take(second.commands)).toMatchObject({
        type: "start",
        hostname: "studio",
      });
    }),
  );

  it.effect("never starts the helper when the policy leaves out remote clients", () =>
    Effect.gen(function* () {
      const { node, spawned } = yield* setup({
        tailnet: { enabled: true },
        policy: {
          schemaVersion: 1,
          organization: "Example Corp",
          limits: { clients: ["desktop", "local-browser"] },
        },
      });
      yield* node.start;
      expect(yield* node.current).toEqual({ state: "unavailable", reason: "managed-policy" });
      expect(yield* Queue.size(spawned)).toBe(0);
      const refused = yield* node.login.pipe(Effect.flip);
      expect(refused).toMatchObject({ reason: "managed-policy" });
      expect(refused.message).toContain("Example Corp's policy does not allow remote clients");
    }),
  );

  it.effect("reports a missing helper instead of starting one", () =>
    Effect.gen(function* () {
      const { node, waitFor } = yield* setup({
        tailnet: { enabled: true },
        binary: { _tag: "Missing" },
      });
      yield* node.start;
      yield* waitFor((status) => status.state === "unavailable");
      expect(yield* node.current).toEqual({ state: "unavailable", reason: "binary-missing" });
      expect(yield* node.login.pipe(Effect.flip)).toMatchObject({ reason: "unavailable" });
    }),
  );
});
