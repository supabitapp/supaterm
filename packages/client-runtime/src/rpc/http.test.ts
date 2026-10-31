import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";
import { HttpClient } from "effect/http";

import { layerRemoteHttpClient } from "./http.ts";

describe("layerRemoteHttpClient", () => {
  it.effect("redacts credential query parameters on HTTP client spans", () => {
    const spans: Array<Tracer.NativeSpan> = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    return Effect.gen(function* () {
      yield* HttpClient.get("https://example.com/ws?wsTicket=secret&clientOs=linux&code=abc");
      const span = spans.find((candidate) => candidate.kind === "client")!;
      expect(span.attributes.get("url.full")).toBe(
        "https://example.com/ws?wsTicket=REDACTED&clientOs=linux&code=REDACTED",
      );
      expect(span.attributes.get("url.query")).toBe(
        "wsTicket=REDACTED&clientOs=linux&code=REDACTED",
      );
    }).pipe(
      Effect.provide(layerRemoteHttpClient(async () => new Response("ok"))),
      Effect.withTracer(tracer),
    );
  });
});
