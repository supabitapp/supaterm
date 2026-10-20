import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";

import {
  type ClaudeCapabilitiesProbe,
  makeClaudeCapabilitiesCache,
  probeClaudeCapabilities,
} from "./ClaudeProvider.ts";

type ProbeError = Effect.Error<ReturnType<typeof probeClaudeCapabilities>>;

const authenticated = {
  email: "first@example.com",
  workspaceId: "first-workspace",
  subscriptionType: "pro",
  tokenSource: "oauth",
  apiKeySource: undefined,
  apiProvider: "firstParty",
  slashCommands: [{ name: "review" }],
  usage: { rate_limits_available: true, rate_limits: null },
} satisfies ClaudeCapabilitiesProbe;

const { usage: _usage, ...withoutUsage } = authenticated;

const makeTestCache = Effect.fnUntraced(function* () {
  const response = yield* Ref.make<Effect.Effect<ClaudeCapabilitiesProbe, ProbeError>>(
    Effect.succeed(authenticated),
  );
  const lookups = yield* Ref.make(0);
  const cache = yield* makeClaudeCapabilitiesCache({
    validateFallback: () => Effect.succeed(true),
    key: "claude-instance",
    lookup: () =>
      Effect.gen(function* () {
        yield* Ref.update(lookups, (count) => count + 1);
        const result = yield* Ref.get(response);
        return yield* result;
      }),
  });
  return { cache, response, lookups };
});

it.effect("retries failures immediately and carries a verified account through one failure", () =>
  Effect.gen(function* () {
    const { cache, response, lookups } = yield* makeTestCache();
    yield* Ref.set(response, Effect.fail(new Cause.TimeoutError()));
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = yield* cache.get.pipe(Effect.result);
      assert.equal(Result.isFailure(result), true);
    }
    assert.equal(yield* Ref.get(lookups), 2);

    yield* Ref.set(response, Effect.succeed(authenticated));
    assert.deepEqual(yield* cache.get, authenticated);
    assert.deepEqual(yield* cache.get, authenticated);
    assert.equal(yield* Ref.get(lookups), 3);

    yield* TestClock.adjust("5 minutes");
    yield* Ref.set(response, Effect.fail(new Cause.TimeoutError()));
    assert.deepEqual(yield* cache.get, withoutUsage);
    assert.equal(yield* Ref.get(lookups), 4);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = yield* cache.get.pipe(Effect.result);
      assert.equal(Result.isFailure(result), true);
      if (Result.isFailure(result)) assert.equal(Cause.isTimeoutError(result.failure), true);
    }
    assert.equal(yield* Ref.get(lookups), 6);

    const recovered = {
      ...authenticated,
      email: "second@example.com",
      workspaceId: "second-workspace",
    };
    yield* Ref.set(response, Effect.succeed(recovered));
    assert.deepEqual(yield* cache.get, recovered);
    assert.equal(yield* Ref.get(lookups), 7);
  }),
);

it.effect(
  "clears remembered authentication on sign-out and rechecks immediately after sign-in",
  () =>
    Effect.gen(function* () {
      const { cache, response, lookups } = yield* makeTestCache();
      yield* cache.get;
      const signedOut = {
        ...authenticated,
        email: undefined,
        workspaceId: undefined,
        subscriptionType: undefined,
        tokenSource: "none",
        apiKeySource: "none",
        usage: { rate_limits_available: false, rate_limits: null },
      };
      yield* Ref.set(response, Effect.succeed(signedOut));
      yield* cache.invalidate;
      assert.deepEqual(yield* cache.get, signedOut);

      yield* Ref.set(response, Effect.fail(new Cause.TimeoutError()));
      assert.equal(Result.isFailure(yield* cache.get.pipe(Effect.result)), true);
      assert.equal(yield* Ref.get(lookups), 3);

      yield* Ref.set(response, Effect.succeed(authenticated));
      assert.deepEqual(yield* cache.get, authenticated);
      assert.equal(yield* Ref.get(lookups), 4);
    }),
);

it.effect("rechecks initialized accounts whose optional usage request failed", () =>
  Effect.gen(function* () {
    const { cache, response, lookups } = yield* makeTestCache();
    yield* Ref.set(response, Effect.succeed(withoutUsage));
    assert.deepEqual(yield* cache.get, withoutUsage);
    assert.deepEqual(yield* cache.get, withoutUsage);
    assert.equal(yield* Ref.get(lookups), 2);
  }),
);

it.effect("keeps remembered accounts isolated between Claude instances", () =>
  Effect.gen(function* () {
    const first = yield* makeTestCache();
    const second = yield* makeTestCache();
    const secondAccount = {
      ...authenticated,
      email: "second@example.com",
      workspaceId: "second-workspace",
    };
    yield* Ref.set(second.response, Effect.succeed(secondAccount));
    yield* first.cache.get;
    yield* second.cache.get;

    yield* Ref.set(first.response, Effect.fail(new Cause.TimeoutError()));
    yield* first.cache.invalidate;
    assert.deepEqual(yield* first.cache.get, withoutUsage);
    assert.deepEqual(yield* second.cache.get, secondAccount);
    assert.equal(yield* Ref.get(first.lookups), 2);
    assert.equal(yield* Ref.get(second.lookups), 1);
  }),
);
