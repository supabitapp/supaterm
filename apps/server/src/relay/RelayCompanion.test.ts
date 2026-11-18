// @effect-diagnostics nodeBuiltinImport:off - checks actual listener ownership and isolation.
import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { relayHttpBaseUrl, relayPublicKey } from "@supaterm/shared/relay/protocol";
import { RelayCompanion, layer } from "./RelayCompanion.ts";
const address = relayHttpBaseUrl(relayPublicKey(NodeCrypto.randomBytes(32)));
const reachable = (origin: string) =>
  new Promise<boolean>((resolve) => {
    const socket = NodeNet.connect(Number(new URL(origin).port), "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
it.effect("shares one environment listener across tabs and closes after the last owner", () =>
  Effect.gen(function* () {
    const service = yield* RelayCompanion;
    const a = yield* service.open(address, "tab-a");
    const b = yield* service.open(address, "tab-b");
    expect(a).toBe(b);
    yield* service.close(address, "tab-a");
    expect(yield* Effect.promise(() => reachable(b))).toBe(true);
    yield* service.close(address, "tab-b");
    expect(yield* Effect.promise(() => reachable(b))).toBe(false);
    const reopened = yield* service.open(address, "tab-c");
    expect(yield* Effect.promise(() => reachable(reopened))).toBe(true);
  }).pipe(Effect.provide(layer())),
);
it.effect("rejects ordinary network destinations", () =>
  Effect.gen(function* () {
    const service = yield* RelayCompanion;
    const result = yield* service.open("https://example.com", "tab").pipe(Effect.result);
    expect(result._tag).toBe("Failure");
  }).pipe(Effect.provide(layer())),
);
