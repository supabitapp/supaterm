import { EnvironmentRegistry } from "@supaterm/client-runtime/connection";
import { EnvironmentId, ThreadId, WS_METHODS } from "@supaterm/contracts";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { vi } from "vite-plus/test";

import {
  createActivityReport,
  layer,
  observeBackgroundActivitySubscription,
  observeShownThreadAttention,
  retainBackgroundScope,
  retainedBackgroundScopes,
  wasRecentlyInteracted,
} from "./backgroundActivityReporter.ts";

describe("wasRecentlyInteracted", () => {
  it("expires interaction independently of window focus", () => {
    expect(wasRecentlyInteracted(10_000, 55_000)).toBe(true);
    expect(wasRecentlyInteracted(10_000, 55_001)).toBe(false);
  });

  it("rejects future timestamps", () => {
    expect(wasRecentlyInteracted(10_001, 10_000)).toBe(false);
  });

  it.effect("retains an observed subscription until its returned finalizer runs", () =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("environment-observation-test");
      const scope = { type: "vcs-status" as const, cwd: "/repo" };
      const releasePassive = yield* observeBackgroundActivitySubscription({
        environmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: scope.cwd, includeRemote: false },
      });
      expect(retainedBackgroundScopes(environmentId)).toEqual([]);
      const release = yield* observeBackgroundActivitySubscription({
        environmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: scope.cwd },
      });

      expect(retainedBackgroundScopes(environmentId)).toEqual([scope]);

      yield* releasePassive;
      expect(retainedBackgroundScopes(environmentId)).toEqual([scope]);

      yield* release;
      expect(retainedBackgroundScopes(environmentId)).toEqual([]);
    }),
  );

  it.effect("keeps delimiter-containing environment and scope values distinct", () =>
    Effect.gen(function* () {
      const firstEnvironmentId = EnvironmentId.make("a");
      const secondEnvironmentId = EnvironmentId.make("a:vcs-status:b");
      const releaseFirst = yield* observeBackgroundActivitySubscription({
        environmentId: firstEnvironmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "b:vcs-status:c" },
      });
      const releaseSecond = yield* observeBackgroundActivitySubscription({
        environmentId: secondEnvironmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "c" },
      });

      expect(retainedBackgroundScopes(firstEnvironmentId)).toEqual([
        { type: "vcs-status", cwd: "b:vcs-status:c" },
      ]);
      expect(retainedBackgroundScopes(secondEnvironmentId)).toEqual([
        { type: "vcs-status", cwd: "c" },
      ]);

      yield* Effect.all([releaseFirst, releaseSecond]);
    }),
  );
});

describe("reporting", () => {
  beforeEach(() => {
    const target = new EventTarget();
    const listeners = {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    };
    vi.stubGlobal("window", {
      ...listeners,
      localStorage: { getItem: () => "client", setItem: () => undefined },
    });
    vi.stubGlobal("document", { ...listeners, visibilityState: "visible", hasFocus: () => true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.effect("keeps reporting after a report is interrupted", () =>
    Effect.gen(function* () {
      const entries = yield* SubscriptionRef.make(
        new Map([[EnvironmentId.make("environment-reporter-test"), {}]]),
      );
      let calls = 0;
      const registry = EnvironmentRegistry.EnvironmentRegistry.of({
        entries,
        run: () => {
          calls += 1;
          return calls === 1 ? Effect.failCause(Cause.interrupt()) : Effect.void;
        },
      } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);

      yield* Layer.build(
        layer.pipe(Layer.provide(Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, registry))),
      );
      yield* TestClock.adjust("1 second");
      expect(calls).toBe(1);

      yield* TestClock.adjust("25 seconds");
      expect(calls).toBe(2);
    }).pipe(Effect.scoped),
  );

  it.effect("reports once to the environment whose shown thread got new attention", () =>
    Effect.gen(function* () {
      const shown = EnvironmentId.make("environment-showing-thread");
      const other = EnvironmentId.make("environment-without-thread");
      const threadId = ThreadId.make("thread-shown");
      const entries = yield* SubscriptionRef.make(
        new Map([
          [shown, {}],
          [other, {}],
        ]),
      );
      const calls: EnvironmentId[] = [];
      const registry = EnvironmentRegistry.EnvironmentRegistry.of({
        entries,
        run: (environmentId: EnvironmentId) => {
          calls.push(environmentId);
          return Effect.void;
        },
      } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);
      yield* Layer.build(
        layer.pipe(Layer.provide(Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, registry))),
      );
      const release = retainBackgroundScope(shown, { type: "thread", threadId });
      observeShownThreadAttention(shown, threadId, "completion:run-1");
      yield* TestClock.adjust("1 second");
      calls.length = 0;

      window.dispatchEvent(new Event("keydown"));
      window.dispatchEvent(new Event("pointermove"));
      observeShownThreadAttention(other, threadId, "approval:request-1");
      observeShownThreadAttention(shown, threadId, "completion:run-1");
      observeShownThreadAttention(shown, threadId, null);
      yield* TestClock.adjust("1 second");
      expect(calls).toEqual([]);

      observeShownThreadAttention(shown, threadId, "approval:request-2");
      observeShownThreadAttention(shown, threadId, "approval:request-2");
      yield* TestClock.adjust("1 second");
      expect(calls).toEqual([shown]);

      release();
      yield* TestClock.adjust("1 second");
      calls.length = 0;
      observeShownThreadAttention(shown, threadId, "completion:run-2");
      yield* TestClock.adjust("1 second");
      expect(calls).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it("carries the shown thread and the last real input, but no input before any", () => {
    const environmentId = EnvironmentId.make("environment-report-test");
    const scope = { type: "thread" as const, threadId: ThreadId.make("thread-report") };
    const release = retainBackgroundScope(environmentId, scope);
    const withoutInput = createActivityReport(environmentId, 1_000, null, 2_000);
    const withInput = createActivityReport(environmentId, 1_500, 1_500, 2_000);
    release();

    expect(withoutInput.scopes).toContainEqual(scope);
    expect(withoutInput).not.toHaveProperty("lastInteractionAt");
    expect(withInput.lastInteractionAt).toEqual(DateTime.makeUnsafe(1_500));
    expect(createActivityReport(environmentId, 1_500, 1_500, 2_000).scopes).not.toContainEqual(
      scope,
    );
  });
});
