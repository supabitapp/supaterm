import {
  type ExecutionEnvironmentDescriptor,
  ORCHESTRATION_V2_WS_METHODS,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ShellStreamItem,
} from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";

import { AVAILABLE_CONNECTION_STATE } from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import * as Persistence from "../platform/persistence.ts";
import type * as RpcSession from "../rpc/session.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import { makeEnvironmentShellState } from "./shell.ts";
import * as ShellSnapshotLoader from "./shellSnapshotHttp.ts";
import { v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import { LIVE_SHELL_SNAPSHOT, PREPARED, TARGET, session } from "./shellSyncTestFixtures.ts";

const FAMILY_DESCRIPTOR = {
  serverVersion: "1.0.0",
  capabilities: { shellThreadFamilies: true, shellOlderDone: true },
} as ExecutionEnvironmentDescriptor;

describe("resuming the shell on a new connection", () => {
  const makeHarness = Effect.fnUntraced(function* (options?: {
    readonly cached?: OrchestrationV2ShellSnapshot;
    readonly cachedOrigin?: Persistence.ShellCacheOrigin;
    readonly early?: {
      readonly serverResumes: boolean;
      readonly holdLoads?: boolean;
    };
  }) {
    const supervisorState = yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE);
    const activeSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
      Option.none(),
    );
    const inputs = yield* SubscriptionRef.make<ReadonlyArray<number | undefined>>([]);
    const subscribeInputs = yield* Ref.make<ReadonlyArray<object>>([]);
    const loadOptions = yield* Queue.unbounded<ShellSnapshotLoader.ShellSnapshotOptions>();
    const releases = yield* Queue.unbounded<void>();
    const httpFallbacks = yield* Ref.make<ReadonlyArray<boolean>>([]);
    const loaderCalls = yield* Ref.make(0);
    const saves = yield* SubscriptionRef.make<ReadonlyArray<number>>([]);
    const savedOrigins = yield* Ref.make<ReadonlyArray<Persistence.ShellCacheOrigin | undefined>>(
      [],
    );
    const wakeups = yield* PubSub.unbounded<ConnectionWakeups.ConnectionWakeup>();
    const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
      target: TARGET,
      state: supervisorState,
      session: activeSession,
      prepared: yield* SubscriptionRef.make(
        Option.some(
          options?.early === undefined ? PREPARED : { ...PREPARED, descriptor: FAMILY_DESCRIPTOR },
        ),
      ),
      connect: Effect.void,
      disconnect: Effect.void,
      retryNow: Effect.void,
    } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
    const cache = Persistence.EnvironmentCacheStore.of({
      loadShell: () =>
        Effect.succeed(
          Option.fromUndefinedOr(options?.cached).pipe(
            Option.map((cached) =>
              options?.cachedOrigin === undefined
                ? cached
                : { ...cached, origin: options.cachedOrigin },
            ),
          ),
        ),
      saveShell: (_environmentId, snapshot, origin) =>
        Ref.update(savedOrigins, (saved) => [...saved, origin]).pipe(
          Effect.andThen(
            SubscriptionRef.update(saves, (saved) => [...saved, snapshot.snapshotSequence]),
          ),
        ),
      loadThread: () => Effect.succeedNone,
      saveThread: () => Effect.void,
      removeThread: () => Effect.void,
      loadServerConfig: () => Effect.succeedNone,
      saveServerConfig: () => Effect.void,
      loadVcsRefs: () => Effect.succeedNone,
      saveVcsRefs: () => Effect.void,
      removeVcsRefs: () => Effect.void,
      clearVcsRefs: () => Effect.void,
      clear: () => Effect.void,
    });
    const snapshotLoader = ShellSnapshotLoader.ShellSnapshotLoader.of({
      load: (_prepared, loadOption = {}) =>
        Queue.offer(loadOptions, loadOption).pipe(
          Effect.andThen(options?.early?.holdLoads === true ? Queue.take(releases) : Effect.void),
          Effect.andThen(Ref.updateAndGet(loaderCalls, (count) => count + 1)),
          Effect.map((count) =>
            Option.some<ShellSnapshotLoader.ShellHttpAnswer>(
              options?.early?.serverResumes === true && loadOption.resumeFrom !== undefined
                ? { resumable: true }
                : {
                    ...LIVE_SHELL_SNAPSHOT,
                    snapshotSequence: count * 10,
                    projectIdentities: `identities-${count}`,
                  },
            ),
          ),
        ),
    });
    const shellState = yield* makeEnvironmentShellState().pipe(
      Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      Effect.provideService(Persistence.EnvironmentCacheStore, cache),
      Effect.provideService(ShellSnapshotLoader.ShellSnapshotLoader, snapshotLoader),
      Effect.provideService(
        ConnectionWakeups.ConnectionWakeups,
        ConnectionWakeups.ConnectionWakeups.of({ changes: Stream.fromPubSub(wakeups) }),
      ),
    );

    const connect = Effect.fnUntraced(function* (
      generation: string | undefined,
      flags: { readonly shellThreadFamilies?: boolean; readonly shellOlderDone?: boolean } = {},
      awaitSubscribed = true,
    ) {
      const events = yield* Queue.unbounded<OrchestrationV2ShellStreamItem, Cause.Done>();
      const client = {
        [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: (input: {
          readonly afterSequence?: number;
          readonly httpSnapshotFallback?: true;
        }) =>
          Stream.unwrap(
            Ref.update(httpFallbacks, (captured) => [
              ...captured,
              input.httpSnapshotFallback === true,
            ]).pipe(
              Effect.andThen(Ref.update(subscribeInputs, (captured) => [...captured, input])),
              Effect.andThen(
                SubscriptionRef.update(inputs, (captured) => [...captured, input.afterSequence]),
              ),
              Effect.as(Stream.fromQueue(events)),
            ),
          ),
      } as unknown as WsRpcProtocolClient;
      const count = (yield* SubscriptionRef.get(inputs)).length;
      yield* SubscriptionRef.set(
        activeSession,
        Option.some({
          ...session(client),
          initialConfig: Effect.succeed({
            shellResumeCompletionMarker: true,
            ...flags,
            ...(generation === undefined ? {} : { shellSyncGeneration: generation }),
          } as never),
        }),
      );
      const subscribed = awaitSubscribed
        ? yield* SubscriptionRef.changes(inputs).pipe(
            Stream.filter((captured) => captured.length > count),
            Stream.runHead,
          )
        : Option.some([]);
      return {
        events,
        afterSequence: Option.getOrThrow(subscribed).at(-1),
        httpSnapshotFallback: (yield* Ref.get(httpFallbacks)).at(-1),
        input: (yield* Ref.get(subscribeInputs)).at(-1),
      };
    });

    const awaitSequence = (sequence: number) =>
      SubscriptionRef.changes(shellState).pipe(
        Stream.filter(
          (value) =>
            Option.isSome(value.snapshot) && value.snapshot.value.snapshotSequence === sequence,
        ),
        Stream.runHead,
      );
    const awaitLive = SubscriptionRef.changes(shellState).pipe(
      Stream.filter((value) => value.status === "live"),
      Stream.runHead,
    );
    const update = (sequence: number) =>
      ({
        kind: "thread.updated",
        sequence,
        location: "active",
        thread: { ...v2ThreadShell, title: `at ${sequence}` },
      }) satisfies OrchestrationV2ShellStreamItem;

    const awaitSubscriptions = (count: number) =>
      SubscriptionRef.changes(inputs).pipe(
        Stream.filter((captured) => captured.length >= count),
        Stream.runHead,
        Effect.map((captured) => Option.getOrThrow(captured)),
      );

    return {
      connect,
      awaitSequence,
      awaitLive,
      awaitSubscriptions,
      update,
      inputs,
      subscribeInputs,
      httpFallbacks,
      loaderCalls,
      loadOptions,
      releaseLoads: Queue.offer(releases, undefined),
      saves,
      savedOrigins,
      wakeups,
      shellState,
    };
  });

  it.effect("resumes a new session to the same server run from the in-memory cursor", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const first = yield* harness.connect("run-1");
      expect(first.afterSequence).toBe(10);
      yield* Queue.offerAll(first.events, [harness.update(12), { kind: "synchronized" }]);
      yield* harness.awaitLive;

      const second = yield* harness.connect("run-1");
      expect(second.afterSequence).toBe(12);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(1);
      yield* Queue.offerAll(second.events, [harness.update(15), { kind: "synchronized" }]);
      yield* harness.awaitSequence(15);

      const third = yield* harness.connect("run-1");
      expect(third.afterSequence).toBe(15);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(1);
    }),
  );

  it.effect("reloads over HTTP after the server restarted", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const first = yield* harness.connect("run-1");
      yield* Queue.offerAll(first.events, [harness.update(12), { kind: "synchronized" }]);
      yield* harness.awaitLive;

      const restarted = yield* harness.connect("run-2");
      expect(restarted.afterSequence).toBe(20);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(2);
    }),
  );

  it.effect("reloads over HTTP from servers that do not report a run", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const first = yield* harness.connect(undefined);
      yield* Queue.offerAll(first.events, [harness.update(12), { kind: "synchronized" }]);
      yield* harness.awaitLive;

      const second = yield* harness.connect(undefined);
      expect(second.afterSequence).toBe(20);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(2);
    }),
  );

  it.effect("never resumes a shell that only came from the disk cache", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cached: { ...LIVE_SHELL_SNAPSHOT, snapshotSequence: 5 },
      });
      const first = yield* harness.connect("run-1");
      expect(first.afterSequence).toBe(10);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(1);
    }),
  );

  const NOW = 1_800_000_000_000;
  const RUN_1_ORIGIN: Persistence.ShellCacheOrigin = {
    generation: "run-1",
    omitIdleSubagents: false,
    omitOlderDone: false,
    snapshotAt: NOW - 60 * 60 * 1000,
  };
  const FAMILY_FLAGS = { shellThreadFamilies: true, shellOlderDone: true };
  const FAMILY_OMISSIONS = { omitIdleSubagents: true, omitOlderDone: true };

  it.effect.each([
    {
      label: "no rows to resume",
      origin: undefined,
      serverResumes: false,
      generation: "run-1",
      flags: FAMILY_FLAGS,
      loads: [FAMILY_OMISSIONS],
      subscribes: { afterSequence: 10, knownProjectIdentities: "identities-1" },
    },
    {
      label: "rows the server can replay from",
      origin: { ...RUN_1_ORIGIN, ...FAMILY_OMISSIONS },
      serverResumes: true,
      generation: "run-1",
      flags: FAMILY_FLAGS,
      loads: [{ ...FAMILY_OMISSIONS, resumeFrom: 5 }],
      subscribes: { afterSequence: 5, httpSnapshotFallback: true },
    },
    {
      label: "rows the server cannot replay from",
      origin: { ...RUN_1_ORIGIN, ...FAMILY_OMISSIONS },
      serverResumes: false,
      generation: "run-1",
      flags: FAMILY_FLAGS,
      loads: [{ ...FAMILY_OMISSIONS, resumeFrom: 5 }],
      subscribes: { afterSequence: 10, knownProjectIdentities: "identities-1" },
    },
    {
      label: "rows from an earlier server run",
      origin: { ...RUN_1_ORIGIN, ...FAMILY_OMISSIONS },
      serverResumes: true,
      generation: "run-2",
      flags: FAMILY_FLAGS,
      loads: [{ ...FAMILY_OMISSIONS, resumeFrom: 5 }, FAMILY_OMISSIONS],
      subscribes: { afterSequence: 20, knownProjectIdentities: "identities-2" },
    },
    {
      label: "a live config with other omissions",
      origin: undefined,
      serverResumes: false,
      generation: "run-1",
      flags: {},
      loads: [FAMILY_OMISSIONS, { omitIdleSubagents: false, omitOlderDone: false }],
      subscribes: { afterSequence: 20, knownProjectIdentities: "identities-2" },
    },
  ])(
    "asks for the shell once the connection is prepared, with $label",
    ({ origin, serverResumes, generation, flags, loads, subscribes }) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const harness = yield* makeHarness({
          cached: { ...LIVE_SHELL_SNAPSHOT, snapshotSequence: 5 },
          ...(origin === undefined ? {} : { cachedOrigin: origin }),
          early: { serverResumes },
        });
        expect(yield* Queue.take(harness.loadOptions)).toEqual(loads[0]);
        if (!serverResumes) {
          const early = Option.getOrThrow(yield* harness.awaitSequence(10));
          expect(early.status).not.toBe("live");
          expect(early.generation).toBeGreaterThan(0);
        }
        expect(yield* SubscriptionRef.get(harness.inputs)).toEqual([]);

        const first = yield* harness.connect(generation, flags);
        expect(first.input).toMatchObject(subscribes);
        for (const key of [
          "afterSequence",
          "httpSnapshotFallback",
          "knownProjectIdentities",
        ] as const) {
          if (!(key in subscribes)) expect(first.input).not.toHaveProperty(key);
        }
        expect(yield* Queue.clear(harness.loadOptions)).toEqual(loads.slice(1));
        expect(yield* Ref.get(harness.loaderCalls)).toBe(loads.length);

        yield* Queue.offerAll(first.events, [
          harness.update(subscribes.afterSequence + 1),
          { kind: "synchronized" },
        ]);
        yield* harness.awaitSequence(subscribes.afterSequence + 1);
        expect(Option.getOrThrow(yield* harness.awaitLive).status).toBe("live");
      }),
  );

  it.effect(
    "loads the shell only once the socket is ready on servers whose descriptor is silent",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        expect(yield* Queue.size(harness.loadOptions)).toBe(0);
        const first = yield* harness.connect("run-1", FAMILY_FLAGS);
        expect(yield* Queue.clear(harness.loadOptions)).toEqual([FAMILY_OMISSIONS]);
        expect(first.input).toMatchObject({
          afterSequence: 10,
          knownProjectIdentities: "identities-1",
        });
      }),
  );

  it.effect("resumes held rows on the socket when the HTTP answer does not come", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const harness = yield* makeHarness({
        cached: { ...LIVE_SHELL_SNAPSHOT, snapshotSequence: 5 },
        cachedOrigin: { ...RUN_1_ORIGIN, ...FAMILY_OMISSIONS },
        early: { serverResumes: false, holdLoads: true },
      });
      yield* Queue.take(harness.loadOptions);
      const first = yield* harness.connect("run-1", FAMILY_FLAGS, false);
      expect(first.input).toBeUndefined();
      yield* TestClock.adjust("2999 millis");
      expect(yield* SubscriptionRef.get(harness.inputs)).toEqual([]);

      yield* TestClock.adjust("1 millis");
      expect(yield* harness.awaitSubscriptions(1)).toEqual([5]);
      expect(yield* Ref.get(harness.httpFallbacks)).toEqual([true]);
      yield* Queue.offerAll(first.events, [harness.update(12), { kind: "synchronized" }]);
      yield* harness.awaitSequence(12);

      yield* harness.releaseLoads;
      yield* TestClock.adjust("1 millis");
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);
      expect(yield* SubscriptionRef.get(harness.shellState)).toMatchObject({
        status: "live",
        snapshot: Option.some({ snapshotSequence: 12 }),
      });
    }),
  );

  it.effect("resumes cached rows that synchronized with the same server run", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const harness = yield* makeHarness({
        cached: { ...LIVE_SHELL_SNAPSHOT, snapshotSequence: 5 },
        cachedOrigin: RUN_1_ORIGIN,
      });
      const first = yield* harness.connect("run-1");
      expect(first.afterSequence).toBe(5);
      expect(first.httpSnapshotFallback).toBe(true);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);
      yield* Queue.offer(first.events, { kind: "synchronized" });
      expect(Option.getOrThrow(yield* harness.awaitLive).generation).toBeGreaterThan(0);
    }),
  );

  it.effect.each([
    { label: "another server run", origin: { ...RUN_1_ORIGIN, generation: "run-0" } },
    { label: "other omissions", origin: { ...RUN_1_ORIGIN, omitIdleSubagents: true } },
    {
      label: "a six hour old snapshot",
      origin: { ...RUN_1_ORIGIN, snapshotAt: NOW - 6 * 3_600_000 },
    },
  ])("reloads cached rows from $label over HTTP", ({ origin }) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const harness = yield* makeHarness({
        cached: { ...LIVE_SHELL_SNAPSHOT, snapshotSequence: 5 },
        cachedOrigin: origin,
      });
      const first = yield* harness.connect("run-1");
      expect(first.afterSequence).toBe(10);
      expect(first.httpSnapshotFallback).toBe(false);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(1);
    }),
  );

  it.effect("caches the server run only with rows that finished a sync", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const harness = yield* makeHarness();
      const first = yield* harness.connect("run-1");
      yield* Queue.offerAll(first.events, [harness.update(12), { kind: "synchronized" }]);
      yield* harness.awaitLive;
      yield* PubSub.publish(harness.wakeups, "application-background");
      yield* SubscriptionRef.changes(harness.saves).pipe(
        Stream.filter((sequences) => sequences.length > 0),
        Stream.runHead,
      );
      expect((yield* Ref.get(harness.savedOrigins)).at(-1)).toEqual({
        ...RUN_1_ORIGIN,
        snapshotAt: NOW,
      });
    }),
  );

  it.effect("reloads over HTTP when the server answers a resume with snapshot-required", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const harness = yield* makeHarness({
        cached: { ...LIVE_SHELL_SNAPSHOT, snapshotSequence: 5 },
        cachedOrigin: RUN_1_ORIGIN,
      });
      const coldResume = yield* harness.connect("run-1");
      expect(coldResume.afterSequence).toBe(5);
      yield* Queue.offer(coldResume.events, { kind: "snapshot-required" });
      expect((yield* harness.awaitSubscriptions(2)).at(-1)).toBe(10);
      expect((yield* Ref.get(harness.httpFallbacks)).at(-1)).toBe(false);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(1);
      yield* Queue.offer(coldResume.events, { kind: "synchronized" });
      yield* harness.awaitLive;

      const warmResume = yield* harness.connect("run-1");
      expect(warmResume.afterSequence).toBe(10);
      expect(warmResume.httpSnapshotFallback).toBe(true);
      yield* Queue.offer(warmResume.events, { kind: "snapshot-required" });
      expect((yield* harness.awaitSubscriptions(4)).at(-1)).toBe(20);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(2);
    }),
  );

  it.effect("reloads when the previous session never reached synchronized", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const first = yield* harness.connect("run-1");
      yield* Queue.offer(first.events, harness.update(12));
      yield* harness.awaitSequence(12);

      const second = yield* harness.connect("run-1");
      expect(second.afterSequence).toBe(20);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(2);
    }),
  );

  it.effect("forgets a completed run once another run's snapshot replaced the shell", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const first = yield* harness.connect("run-1");
      yield* Queue.offerAll(first.events, [harness.update(12), { kind: "synchronized" }]);
      yield* harness.awaitLive;

      const other = yield* harness.connect("run-2");
      expect(other.afterSequence).toBe(20);

      const back = yield* harness.connect("run-1");
      expect(back.afterSequence).toBe(30);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(3);
    }),
  );

  it.effect("keeps the cursor a resumed session reached before it dropped", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const first = yield* harness.connect("run-1");
      yield* Queue.offerAll(first.events, [harness.update(12), { kind: "synchronized" }]);
      yield* harness.awaitLive;

      const second = yield* harness.connect("run-1");
      expect(second.afterSequence).toBe(12);
      yield* Queue.offer(second.events, harness.update(14));
      yield* harness.awaitSequence(14);

      const third = yield* harness.connect("run-1");
      expect(third.afterSequence).toBe(14);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(1);
    }),
  );

  it.effect("reloads after skipping an unknown item, then resumes again", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const first = yield* harness.connect("run-1");
      yield* Queue.offerAll(first.events, [
        harness.update(12),
        { kind: "synchronized" },
        { kind: "unknown-item", itemKind: "project.archived" },
        harness.update(13),
      ]);
      yield* harness.awaitSequence(13);

      const second = yield* harness.connect("run-1");
      expect(second.afterSequence).toBe(20);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(2);
      yield* Queue.offer(second.events, { kind: "synchronized" });
      yield* harness.awaitLive;

      const third = yield* harness.connect("run-1");
      expect(third.afterSequence).toBe(20);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(2);
    }),
  );

  it.effect("reloads instead of resuming once the last snapshot is six hours old", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const first = yield* harness.connect("run-1");
      yield* Queue.offerAll(first.events, [harness.update(12), { kind: "synchronized" }]);
      yield* harness.awaitLive;
      yield* TestClock.adjust("361 minutes");

      const second = yield* harness.connect("run-1");
      expect(second.afterSequence).toBe(20);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(2);
      yield* Queue.offerAll(second.events, [{ kind: "synchronized" }, harness.update(21)]);
      yield* harness.awaitSequence(21);

      const third = yield* harness.connect("run-1");
      expect(third.afterSequence).toBe(21);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(2);
    }),
  );

  it.effect("keeps resuming while the last snapshot is younger than six hours", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const first = yield* harness.connect("run-1");
      yield* Queue.offerAll(first.events, [harness.update(12), { kind: "synchronized" }]);
      yield* harness.awaitLive;
      yield* TestClock.adjust("359 minutes");

      const second = yield* harness.connect("run-1");
      expect(second.afterSequence).toBe(12);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(1);
    }),
  );

  it.effect("writes the shell cache as soon as the app goes to the background", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const first = yield* harness.connect("run-1");
      yield* Queue.offerAll(first.events, [harness.update(12), { kind: "synchronized" }]);
      yield* harness.awaitLive;
      expect(yield* SubscriptionRef.get(harness.saves)).toEqual([]);

      yield* PubSub.publish(harness.wakeups, "application-background");
      const saved = yield* SubscriptionRef.changes(harness.saves).pipe(
        Stream.filter((sequences) => sequences.length > 0),
        Stream.runHead,
      );
      expect(Option.getOrThrow(saved)).toEqual([12]);
    }),
  );
});
