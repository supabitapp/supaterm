import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { refreshKeymap } from "./keymap.ts";
import { CodexMicroRpcError } from "./transport.ts";

interface Request {
  readonly method: string;
  readonly params: unknown;
}

// Serves keymap.json the way the firmware does, never more than `chunkBytes` per read.
function fakeKeyboard(keymap: string, options: { readonly chunkBytes?: number } = {}) {
  const bytes = new TextEncoder().encode(keymap);
  const requests: Array<Request> = [];
  const request = (method: string, params?: unknown) =>
    Effect.suspend((): Effect.Effect<unknown, CodexMicroRpcError> => {
      requests.push({ method, params });
      if (method === "fs.list") {
        return Effect.succeed([
          { name: "smart_actions.json", size: 2, checksum: "other" },
          { name: "keymap.json", size: bytes.length, checksum: `sum-${keymap.length}` },
        ]);
      }
      if (method !== "fs.readbin") {
        return Effect.fail(new CodexMicroRpcError({ method, code: -32601 }));
      }
      const { offset, len } = params as { offset: number; len: number };
      const data = bytes.subarray(offset, offset + Math.min(len, options.chunkBytes ?? len));
      return Effect.succeed({ data: Buffer.from(data).toString("base64") });
    });
  return { request, requests };
}

const layers = (...keymaps: ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>>) =>
  JSON.stringify({ profiles: [{ layers: keymaps.map((keymap) => ({ layout: { keymap } })) }] });

describe("refreshKeymap", () => {
  it.effect("counts each agent key mapped on any layer, by exact keycode", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [string, number | null]> = [
        [layers([["KV_OAI_AG00", "KC_A"]], [["KV_OAI_AG03", "KV_OAI_AG00", "KV_OAI_ACT06"]]), 2],
        [layers([["KV_OAI_AG00_unused", "KV_OAI_AG19"]]), 0],
        [JSON.stringify({ note: "KV_OAI_AG00 KV_OAI_AG01", profiles: [] }), 0],
        ['{"profiles":[{"layers":[{"layout":{"keymap":[["\\u004bV_OAI_AG05"]]}}]}]}', 1],
        ["null", null],
        ['{"profiles": [', null],
      ];
      for (const [keymap, expected] of cases) {
        const keyboard = fakeKeyboard(keymap, { chunkBytes: 16 });
        const result = yield* refreshKeymap(keyboard.request, undefined);
        assert.strictEqual(result?.mappedAgentKeys, expected, keymap);
      }
    }),
  );

  it.effect("reads only when the keymap's checksum has changed", () =>
    Effect.gen(function* () {
      const keyboard = fakeKeyboard(layers([["KV_OAI_AG00"]]));
      const first = yield* refreshKeymap(keyboard.request, undefined);
      assert.strictEqual(first?.mappedAgentKeys, 1);
      keyboard.requests.length = 0;
      assert.strictEqual(yield* refreshKeymap(keyboard.request, first), first);
      assert.deepStrictEqual(
        keyboard.requests.map((request) => request.method),
        ["fs.list"],
      );
    }),
  );

  it.effect("leaves the keymap unknown when the keyboard cannot list or read it", () =>
    Effect.gen(function* () {
      const unlisted = (method: string) =>
        Effect.fail(new CodexMicroRpcError({ method, code: -32601 }));
      assert.isUndefined(yield* refreshKeymap(unlisted, undefined));

      const endsEarly = (method: string, params?: unknown) =>
        Effect.succeed(
          method === "fs.list"
            ? [{ name: "keymap.json", size: 64, checksum: "sum" }]
            : { data: (params as { offset: number }).offset === 0 ? "e30=" : "" },
        );
      assert.isUndefined(yield* refreshKeymap(endsEarly, undefined));
    }),
  );
});
