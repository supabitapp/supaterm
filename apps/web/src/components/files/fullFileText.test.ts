import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";

import { downloadText } from "./fullFileText";
import { RENDERED_MAX_LINES } from "./largeTextProtocol";

const encoder = new TextEncoder();

const download = (...chunks: Array<Uint8Array>) =>
  downloadText("http://localhost/assets/file.ts").pipe(
    Stream.runLast,
    Effect.map(Option.getOrThrow),
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(chunk.slice());
              controller.close();
            },
          }),
        ),
      ),
    ),
  );

describe("downloadText", () => {
  it.effect(
    "drops a leading byte order mark as the preview read does, and keeps a later U+FEFF",
    () =>
      Effect.gen(function* () {
        const whole = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("one\n﻿two\n")]);
        expect((yield* download(whole)).text).toBe("one\n﻿two\n");
      }),
  );

  it.effect("fails on malformed UTF-8 past the first read, which the preview read refuses", () =>
    Effect.gen(function* () {
      const e = encoder.encode("é");
      const split = yield* download(encoder.encode("caf"), e.subarray(0, 1), e.subarray(1));
      expect(split.text).toBe("café");
      const ascii = encoder.encode("one\n");
      expect(
        Exit.isFailure(yield* Effect.exit(download(ascii, new Uint8Array([0xe9, 0x0a])))),
      ).toBe(true);
      expect(Exit.isFailure(yield* Effect.exit(download(ascii, e.subarray(0, 1))))).toBe(true);
    }),
  );

  it.effect("stops at the first text past the lines the main thread can lay out", () =>
    Effect.gen(function* () {
      const file = yield* download(encoder.encode("\n".repeat(RENDERED_MAX_LINES + 10)));
      expect(file.lines).toBeGreaterThan(RENDERED_MAX_LINES);
    }),
  );
});
