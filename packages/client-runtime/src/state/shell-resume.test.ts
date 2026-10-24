import {
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

describe("resuming the shell on a new connection", () => {
  const makeHarness = Effect.fnUntraced(function* (options?: {
    readonly cached?: OrchestrationV2ShellSnapshot;
  }) {
    const supervisorState = yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE);
    const activeSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
      Option.none(),
    );
    const inputs = yield* SubscriptionRef.make<ReadonlyArray<number | undefined>>([]);
    const loaderCalls = yield* Ref.make(0);
    const saves = yield* SubscriptionRef.make<ReadonlyArray<number>>([]);
    const wakeups = yield* PubSub.unbounded<ConnectionWakeups.ConnectionWakeup>();
    const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
      target: TARGET,
      state: supervisorState,
      session: activeSession,
      prepared: yield* SubscriptionRef.make(Option.some(PREPARED)),
      connect: Effect.void,
      disconnect: Effect.void,
      retryNow: Effect.void,
    } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
    const cache = Persistence.EnvironmentCacheStore.of({
      loadShell: () => Effect.succeed(Option.fromUndefinedOr(options?.cached)),
      saveShell: (_environmentId, snapshot) =>
        SubscriptionRef.update(saves, (saved) => [...saved, snapshot.snapshotSequence]),
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
    // Each HTTP load returns a fresh authoritative snapshot at 10, 20, 30, ...
    const snapshotLoader = ShellSnapshotLoader.ShellSnapshotLoader.of({
      load: () =>
        Ref.updateAndGet(loaderCalls, (count) => count + 1).pipe(
          Effect.map((count) =>
            Option.some({ ...LIVE_SHELL_SNAPSHOT, snapshotSequence: count * 10 }),
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

    /** Connects a new session to a server run, and resolves once the client subscribed. */
    const connect = Effect.fnUntraced(function* (generation: string | undefined) {
      const events = yield* Queue.unbounded<OrchestrationV2ShellStreamItem, Cause.Done>();
      const client = {
        [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: (input: {
          readonly afterSequence?: number;
        }) =>
          Stream.unwrap(
            SubscriptionRef.update(inputs, (captured) => [...captured, input.afterSequence]).pipe(
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
            ...(generation === undefined ? {} : { shellSyncGeneration: generation }),
          } as never),
        }),
      );
      const subscribed = yield* SubscriptionRef.changes(inputs).pipe(
        Stream.filter((captured) => captured.length > count),
        Stream.runHead,
      );
      return {
        events,
        afterSequence: Option.getOrThrow(subscribed).at(-1),
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
    const update = (sequence: number): OrchestrationV2ShellStreamItem => ({
      kind: "thread.updated",
      sequence,
      location: "active",
      thread: { ...v2ThreadShell, title: `at ${sequence}` },
    });

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
      loaderCalls,
      saves,
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

      // Another server process answers for the same environment, then drops before completing.
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
      // The connection drops partway through catching up, before `synchronized`.
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

      // The reload took a fresh snapshot, so the next session resumes again.
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
      // The throttled writer waits on the test clock, so nothing is saved yet.
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
