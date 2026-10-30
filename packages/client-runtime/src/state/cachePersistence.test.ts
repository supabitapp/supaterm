import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ConnectionWakeups from "../connection/wakeups.ts";
import { runCachePersistence } from "./cachePersistence.ts";

describe("runCachePersistence", () => {
  it.effect("coalesces the initial write and keeps the later persistence deadline", () =>
    Effect.gen(function* () {
      const snapshots = yield* Queue.sliding<number>(1);
      const saved = yield* Queue.unbounded<number>();
      yield* runCachePersistence(snapshots, (value) =>
        Queue.offer(saved, value).pipe(Effect.asVoid),
      ).pipe(Effect.forkScoped);

      yield* Queue.offer(snapshots, 1);
      yield* TestClock.adjust("499 millis");
      expect(yield* Queue.poll(saved)).toEqual(Option.none());
      yield* Queue.offer(snapshots, 2);
      yield* TestClock.adjust("1 millis");
      expect(yield* Queue.take(saved)).toBe(2);

      yield* Queue.offer(snapshots, 3);
      yield* TestClock.adjust("9999 millis");
      expect(yield* Queue.poll(saved)).toEqual(Option.none());
      yield* TestClock.adjust("1 millis");
      expect(yield* Queue.take(saved)).toBe(3);
    }),
  );

  it.effect("flushes on background after a timed wait and stops when interrupted", () =>
    Effect.gen(function* () {
      const snapshots = yield* Queue.sliding<number>(1);
      const saved = yield* Queue.unbounded<number>();
      const wakeups = yield* PubSub.unbounded<ConnectionWakeups.ConnectionWakeup>();
      const fiber = yield* runCachePersistence(snapshots, (value) =>
        Queue.offer(saved, value).pipe(Effect.asVoid),
      ).pipe(
        Effect.provideService(
          ConnectionWakeups.ConnectionWakeups,
          ConnectionWakeups.ConnectionWakeups.of({ changes: Stream.fromPubSub(wakeups) }),
        ),
        Effect.forkScoped,
      );

      yield* Queue.offer(snapshots, 1);
      yield* TestClock.adjust("500 millis");
      expect(yield* Queue.take(saved)).toBe(1);
      yield* Queue.offer(snapshots, 2);
      yield* PubSub.publish(wakeups, "application-background");
      expect(yield* Queue.take(saved)).toBe(2);

      yield* Fiber.interrupt(fiber);
      yield* Queue.offer(snapshots, 3);
      yield* PubSub.publish(wakeups, "application-background");
      yield* TestClock.adjust("10 seconds");
      expect(yield* Queue.poll(saved)).toEqual(Option.none());
    }),
  );
});
