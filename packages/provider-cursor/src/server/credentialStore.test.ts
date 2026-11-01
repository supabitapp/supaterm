import type { StoredSdkCredentials } from "@cursor/sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId } from "@supaterm/contracts";
import * as Effect from "effect/Effect";

import * as ProviderHost from "@supaterm/provider-core/server/ProviderHost";
import * as TestProviderHost from "@supaterm/provider-testing/TestProviderHost";
import * as Layer from "effect/Layer";
import { makeCursorCredentialStore } from "./credentialStore.ts";

const layerHost = Layer.provideMerge(TestProviderHost.layer(), NodeServices.layer);

it.effect(
  "restores SDK credentials in a new controller and keeps another account when signing out",
  () =>
    Effect.gen(function* () {
      const host = yield* ProviderHost.ProviderHost;
      const makeStore = (id: string) => makeCursorCredentialStore(ProviderInstanceId.make(id));
      const personal = yield* makeStore("personal");
      const work = yield* makeStore("work");
      const credentials = {
        version: 1 as const,
        backendUrl: "https://api.cursor.com",
        apiKey: "test-only-key",
        createdAtMs: 100,
        apiKeyExpiresAtMs: 1000,
        email: "test@example.com",
      };
      yield* Effect.tryPromise(() => personal.store.save(credentials));
      yield* Effect.tryPromise(() =>
        work.store.save({ ...credentials, apiKey: "test-only-work-key" }),
      );
      const restored = yield* makeStore("personal");
      assert.deepEqual(yield* Effect.tryPromise(() => restored.store.load()), credentials);
      yield* (yield* host.credentials("cursor", "personal")).set(
        new TextEncoder().encode("damaged credential"),
      );
      assert.isUndefined(yield* Effect.tryPromise(() => restored.store.load()));
      yield* Effect.tryPromise(() => restored.store.save(credentials));
      yield* Effect.tryPromise(() => restored.store.clear());
      assert.isUndefined(yield* Effect.tryPromise(() => personal.store.load()));
      assert.strictEqual(
        (yield* Effect.tryPromise(() => work.store.load()))?.apiKey,
        "test-only-work-key",
      );
    }).pipe(Effect.provide(layerHost)),
);

it.effect.each([
  {
    name: "an undefined email",
    optionalFields: { email: undefined, apiKeyExpiresAtMs: 1000 },
    expectedFields: { apiKeyExpiresAtMs: 1000 },
  },
  {
    name: "an undefined expiry",
    optionalFields: { email: "test@example.com", apiKeyExpiresAtMs: undefined },
    expectedFields: { email: "test@example.com" },
  },
  {
    name: "both optional fields undefined",
    optionalFields: { email: undefined, apiKeyExpiresAtMs: undefined },
    expectedFields: {},
  },
  {
    name: "both optional fields omitted",
    optionalFields: {},
    expectedFields: {},
  },
])("restores SDK credentials with $name in a new store", ({ optionalFields, expectedFields }) =>
  Effect.gen(function* () {
    const instanceId = ProviderInstanceId.make("personal");
    const { store } = yield* makeCursorCredentialStore(instanceId);
    const requiredFields: StoredSdkCredentials = {
      version: 1,
      backendUrl: "https://api.cursor.com",
      apiKey: "test-only-key",
      createdAtMs: 100,
    };
    const credentials = { ...requiredFields };
    // Match the SDK's runtime values without relying on its stricter declarations.
    Object.assign(credentials, optionalFields);
    yield* Effect.tryPromise(() => store.save(credentials));

    const restored = yield* makeCursorCredentialStore(instanceId);
    assert.deepEqual(yield* Effect.tryPromise(() => restored.store.load()), {
      ...requiredFields,
      ...expectedFields,
    });
  }).pipe(Effect.provide(layerHost)),
);
