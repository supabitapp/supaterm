import {
  DEFAULT_SERVER_SETTINGS,
  type RelayHostStatus,
  type RelayConnectionInfo,
  type ServerSettings,
} from "@supaterm/contracts";
import { expect, it } from "@effect/vitest";
import { beforeEach, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as RelayAccess from "./RelayAccess.ts";
import * as RelayIdentity from "./RelayIdentity.ts";
import { RelayIngress } from "./RelayIngress.ts";
import type { startRelayTransport } from "./transport.ts";

type TransportInput = Parameters<typeof startRelayTransport>[0];
const noTransportStop = () => {};
const relayTransport: {
  readonly calls: Array<TransportInput>;
  respond: (input: TransportInput) => () => void;
} = { calls: [], respond: () => noTransportStop };
beforeEach(() => {
  relayTransport.calls.length = 0;
  relayTransport.respond = () => noTransportStop;
});

const fixture = Effect.gen(function* () {
  const settings = yield* SubscriptionRef.make(DEFAULT_SERVER_SETTINGS);
  const changes = yield* PubSub.unbounded<ServerSettings>();
  const secrets = new Map<string, Uint8Array>();
  const layerSecrets = Layer.succeed(ServerSecretStore.ServerSecretStore, {
    get: (name) => Effect.sync(() => Option.fromUndefinedOr(secrets.get(name))),
    getOrCreateRandom: (name, size) =>
      Effect.sync(() => {
        const secret = secrets.get(name) ?? new Uint8Array(size).fill(1);
        secrets.set(name, secret);
        return secret;
      }),
    set: (name, value) =>
      Effect.sync(() => {
        secrets.set(name, value);
      }),
    create: (name, value) =>
      Effect.sync(() => {
        secrets.set(name, value);
      }),
    remove: (name) =>
      Effect.sync(() => {
        secrets.delete(name);
      }),
  });
  const layer = RelayAccess.layer.pipe(
    Layer.provide(RelayIdentity.layer.pipe(Layer.provide(layerSecrets))),
    Layer.provide(
      Layer.mock(ServerSettingsService.ServerSettingsService, {
        getSettings: SubscriptionRef.get(settings),
        subscribeChanges: PubSub.subscribe(changes).pipe(Effect.map(Stream.fromSubscription)),
      }),
    ),
    Layer.provide(Layer.succeed(RelayIngress, { accept: () => {} })),
    Layer.provide(
      Layer.succeed(RelayAccess.RelayTransportStarter, (input) => {
        relayTransport.calls.push(input);
        return relayTransport.respond(input);
      }),
    ),
  );
  const setEnabled = (enabled: boolean) =>
    SubscriptionRef.updateAndGet(settings, (value) => ({
      ...value,
      publicRelayEnabled: enabled,
    })).pipe(Effect.flatMap((value) => PubSub.publish(changes, value)));
  const setRelayUrl = (publicRelayUrl: string) =>
    SubscriptionRef.updateAndGet(settings, (value) => ({ ...value, publicRelayUrl })).pipe(
      Effect.flatMap((value) => PubSub.publish(changes, value)),
    );
  return { settings, secrets, layer, setEnabled, setRelayUrl };
});
const awaitState = (service: RelayAccess.RelayAccess["Service"], state: RelayHostStatus["state"]) =>
  service.status.pipe(
    Stream.filter((value) => value.state === state),
    Stream.runHead,
  );
const openTransport = Effect.sync(() => {
  const opened = Promise.withResolvers<TransportInput>();
  const stopped = vi.fn();
  relayTransport.respond = (input) => {
    opened.resolve(input);
    return stopped;
  };
  return { opened: Effect.promise(() => opened.promise), stopped };
});

it.effect("stays idle by default without creating an identity when started or toggled", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    yield* Effect.gen(function* () {
      const service = yield* RelayAccess.RelayAccess;
      yield* service.start;
      expect((yield* awaitState(service, "idle"))._tag).toBe("Some");
      expect(yield* service.advertisement).toEqual({});
      yield* test.setEnabled(false);
      yield* awaitState(service, "off");
      yield* test.setEnabled(true);
      yield* awaitState(service, "idle");
      expect(test.secrets.size).toBe(0);
      expect(relayTransport.calls).toEqual([]);
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect("shares activation and waits for registration before returning a relay address", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const transport = yield* openTransport;
    yield* Effect.gen(function* () {
      const service = yield* RelayAccess.RelayAccess;
      yield* service.start;
      const first = yield* service.prepare.pipe(Effect.forkChild);
      const input = yield* transport.opened;
      const second = yield* service.prepare.pipe(Effect.forkChild);
      expect(first.pollUnsafe()).toBeUndefined();
      expect(test.secrets.has("relay-identity")).toBe(true);
      input.onStatus?.("registered");
      const result = yield* Fiber.join(first);
      expect(yield* Fiber.join(second)).toEqual(result);
      expect(result.relayEndpoint).toMatch(/^https:\/\//);
      expect(yield* service.prepare).toEqual(result);
      expect(relayTransport.calls).toHaveLength(1);
    }).pipe(Effect.provide(test.layer), Effect.scoped);
    expect(transport.stopped).toHaveBeenCalledTimes(1);
  }),
);

it.effect("reconnects an activated host after restart and disable/re-enable", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    test.secrets.set("relay-identity", new Uint8Array(32).fill(2));
    const stopped = vi.fn();
    relayTransport.respond = () => stopped;
    const run = Effect.scoped(
      Effect.gen(function* () {
        const service = yield* RelayAccess.RelayAccess;
        yield* service.start;
        yield* awaitState(service, "connecting");
        expect(yield* service.advertisement).toHaveProperty("relayEndpoint");
        yield* test.setEnabled(false);
        yield* awaitState(service, "off");
        expect(yield* service.advertisement).toEqual({});
        yield* test.setEnabled(true);
        yield* awaitState(service, "connecting");
      }).pipe(Effect.provide(test.layer)),
    );
    yield* run;
    yield* run;
    expect(relayTransport.calls).toHaveLength(4);
    expect(stopped).toHaveBeenCalledTimes(4);
  }),
);

it.effect("fails preparation when disabled and ignores callbacks from the old transport", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const transport = yield* openTransport;
    yield* Effect.gen(function* () {
      const service = yield* RelayAccess.RelayAccess;
      yield* service.start;
      const pending = yield* service.prepare.pipe(Effect.flip, Effect.forkChild);
      const old = yield* transport.opened;
      yield* test.setEnabled(false);
      expect((yield* Fiber.join(pending)).reason).toBe("off");
      yield* test.setEnabled(true);
      yield* awaitState(service, "connecting");
      old.onStatus?.("registered");
      const current = relayTransport.calls.at(-1);
      current?.onStatus?.("superseded");
      yield* awaitState(service, "superseded");
      expect((yield* service.prepare.pipe(Effect.flip)).reason).toBe("superseded");
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect("times out registration and permits a later retry", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const transport = yield* openTransport;
    yield* Effect.gen(function* () {
      const service = yield* RelayAccess.RelayAccess;
      yield* service.start;
      const pending = yield* service.prepare.pipe(Effect.flip, Effect.forkChild);
      const input = yield* transport.opened;
      yield* TestClock.adjust("20 seconds");
      expect((yield* Fiber.join(pending)).reason).toBe("timeout");
      input.onStatus?.("registered");
      yield* awaitState(service, "registered");
      expect(yield* service.prepare).toHaveProperty("relayEndpoint");
      expect(relayTransport.calls).toHaveLength(1);
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect.each([
  { enabled: false, url: "wss://relay.invalid", reason: "off" },
  { enabled: true, url: "https://relay.invalid", reason: "invalid-url" },
])("rejects unavailable settings without activating (%#)", ({ enabled, url, reason }) =>
  Effect.gen(function* () {
    const test = yield* fixture;
    yield* SubscriptionRef.update(test.settings, (value) => ({
      ...value,
      publicRelayEnabled: enabled,
      publicRelayUrl: url,
    }));
    yield* Effect.gen(function* () {
      const service = yield* RelayAccess.RelayAccess;
      yield* service.start;
      expect((yield* service.prepare.pipe(Effect.flip)).reason).toBe(reason);
      expect(test.secrets.size).toBe(0);
      expect(relayTransport.calls).toEqual([]);
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect("recovers a superseded host when disable and re-enable are queued together", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    test.secrets.set("relay-identity", new Uint8Array(32).fill(3));
    const stopped = vi.fn();
    relayTransport.respond = () => stopped;
    yield* Effect.gen(function* () {
      const service = yield* RelayAccess.RelayAccess;
      yield* service.start;
      relayTransport.calls[0]?.onStatus?.("superseded");
      yield* awaitState(service, "superseded");
      yield* test.setEnabled(false);
      yield* test.setEnabled(true);
      yield* awaitState(service, "connecting");
      expect(stopped).toHaveBeenCalledTimes(1);
      expect(relayTransport.calls).toHaveLength(2);
      relayTransport.calls[1]?.onStatus?.("registered");
      expect(yield* service.prepare).toHaveProperty("relayEndpoint");
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect("advertises the first activation and later changes without activating an idle host", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const lifecycle: string[] = [];
    relayTransport.respond = ({ relayUrl }) => {
      lifecycle.push(`start:${relayUrl}`);
      return () => {
        lifecycle.push(`stop:${relayUrl}`);
      };
    };
    yield* Effect.gen(function* () {
      const service = yield* RelayAccess.RelayAccess;
      const advertisements = yield* Queue.unbounded<RelayConnectionInfo | null>();
      yield* service.advertisements.pipe(
        Stream.runForEach((value) =>
          Effect.sync(() => {
            lifecycle.push(`advertise:${value?.relayUrl ?? "off"}`);
          }).pipe(Effect.andThen(Queue.offer(advertisements, value))),
        ),
        Effect.forkChild,
      );
      expect(yield* Queue.take(advertisements)).toBeNull();
      yield* service.start;
      expect((yield* awaitState(service, "idle"))._tag).toBe("Some");
      expect(relayTransport.calls).toEqual([]);
      const preparing = yield* service.prepare.pipe(Effect.forkChild);
      const first = yield* Queue.take(advertisements);
      expect(first?.relayUrl).toBe(DEFAULT_SERVER_SETTINGS.publicRelayUrl);
      const report = relayTransport.calls[0]!.onStatus;
      report?.("registered");
      expect(yield* Fiber.join(preparing)).toEqual(first);
      report?.("superseded");
      yield* awaitState(service, "superseded");
      yield* test.setRelayUrl("wss://second.example.test");
      expect(yield* Queue.take(advertisements)).toEqual({
        ...first,
        relayUrl: "wss://second.example.test",
      });
      yield* test.setEnabled(false);
      expect(yield* Queue.take(advertisements)).toBeNull();
      expect(lifecycle).toEqual([
        "advertise:off",
        `start:${DEFAULT_SERVER_SETTINGS.publicRelayUrl}`,
        `advertise:${DEFAULT_SERVER_SETTINGS.publicRelayUrl}`,
        `stop:${DEFAULT_SERVER_SETTINGS.publicRelayUrl}`,
        "start:wss://second.example.test",
        "advertise:wss://second.example.test",
        "stop:wss://second.example.test",
        "advertise:off",
      ]);
    }).pipe(Effect.provide(test.layer));
  }),
);
