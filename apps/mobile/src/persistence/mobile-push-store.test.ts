import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vite-plus/test";

const { values } = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    values.set(key, value);
  },
}));

import * as MobilePushStore from "./mobile-push-store";
import * as MobileSecureStorage from "./mobile-secure-storage";

const makeStore = MobilePushStore.make.pipe(Effect.provide(MobileSecureStorage.layer));

const settings: MobilePushStore.MobilePushSettings = {
  enabled: true,
  preview: "full",
  kinds: { approval: true, input: true, completion: false, failure: true, "usage-limit": false },
  registrations: [
    {
      environmentId: "environment-1" as never,
      registrationId: "6f1c2b9e-3a4d-4e5f-8a6b-7c8d9e0f1a2b",
      keyId: "0b9f8e7d-6c5b-4a39-8281-7f6e5d4c3b2a",
      publicKey: "P".repeat(43),
      hostKey: "H".repeat(43),
      handle: "AAAAAAAAAAAAAAAAAAAAAA",
      gatewayOrigin: "https://push.supaterm.com",
      installationId: "installation-1",
      preview: "full",
      kinds: {
        approval: true,
        input: true,
        completion: false,
        failure: true,
        "usage-limit": false,
      },
    },
  ],
  retiredHandles: [{ installationId: "installation-1", handle: "BBBBBBBBBBBBBBBBBBBBBB" }],
  revokedEnvironments: ["environment-2" as never],
};

beforeEach(() => values.clear());

describe("mobile push store", () => {
  it.effect("starts disabled with titles preselected", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      expect(yield* store.load).toEqual(MobilePushStore.DEFAULT_MOBILE_PUSH_SETTINGS);
      expect(MobilePushStore.DEFAULT_MOBILE_PUSH_SETTINGS).toMatchObject({
        enabled: false,
        preview: "titles",
      });
    }),
  );

  it.effect("round-trips saved settings", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      yield* store.save(settings);
      expect(yield* store.load).toEqual(settings);
    }),
  );

  it.effect("reads settings saved before environments could be turned off one by one", () =>
    Effect.gen(function* () {
      const { revokedEnvironments: _, ...older } = settings;
      values.set("supaterm.push.settings", JSON.stringify(older));
      const store = yield* makeStore;
      expect(yield* store.load).toEqual({ ...older, revokedEnvironments: [] });
    }),
  );

  it.effect("treats unreadable settings as never configured", () =>
    Effect.gen(function* () {
      values.set("supaterm.push.settings", JSON.stringify({ enabled: "yes" }));
      const store = yield* makeStore;
      expect(yield* store.load).toEqual(MobilePushStore.DEFAULT_MOBILE_PUSH_SETTINGS);
    }),
  );
});
