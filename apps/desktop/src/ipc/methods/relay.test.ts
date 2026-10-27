import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { DesktopRelayGateway } from "../../relay/DesktopRelayGateway.ts";
import { getRelayVia, startRelay } from "./relay.ts";

const address = `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.alt/`;
const relayUrl = "wss://relay.example";
const direct = Array.from({ length: 8 }, (_, index) => `ws://10.0.0.${index + 1}:3773`);

it.effect("starts a relay only with at most eight well-formed direct candidates", () => {
  const started: Array<ReadonlyArray<string> | undefined> = [];
  const gateway = Layer.mock(DesktopRelayGateway, {
    start: (_address, _relayUrl, directUrls) =>
      Effect.sync(() => {
        started.push(directUrls);
        return "http://127.0.0.1:4321";
      }),
    via: () => Effect.succeed("direct" as const),
  });
  return Effect.gen(function* () {
    expect(yield* startRelay.handler({ address, relayUrl, directUrls: direct })).toBe(
      "http://127.0.0.1:4321",
    );
    expect(yield* startRelay.handler({ address, relayUrl })).toBe("http://127.0.0.1:4321");
    for (const directUrls of [
      [...direct, "ws://10.0.0.9:3773"],
      ["http://10.0.0.1:3773"],
      ["ws://user:secret@10.0.0.1:3773"],
      ["ws://10.0.0.1:3773/"],
      ["ws://10.0.0.1:3773?token=1"],
      "ws://10.0.0.1:3773",
    ]) {
      const result = yield* startRelay
        .handler({ address, relayUrl, directUrls })
        .pipe(Effect.result);
      expect(result._tag).toBe("Failure");
    }
    expect(started).toEqual([direct, undefined]);
    expect(yield* getRelayVia.handler(address)).toBe("direct");
  }).pipe(Effect.provide(gateway));
});
