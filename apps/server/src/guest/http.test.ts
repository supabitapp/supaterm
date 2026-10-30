import { GUEST_STREAM_MAX_EVENT_BYTES } from "@supaterm/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { HttpServerRequest } from "effect/http";

import { eventStreamResponse, readSubmission } from "./http.ts";

it.effect("keeps a JSON file a guest attaches as a file, not a form field", () =>
  Effect.gen(function* () {
    const form = new FormData();
    form.append("shareId", "share-1");
    form.append("text", "");
    form.append("file", new File(['{"a":1}'], "data.json", { type: "application/json" }));
    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/api/guest/messages?share=share-1", {
        method: "POST",
        body: form,
      }),
    );
    const submission = yield* readSubmission.pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, request),
    );
    assert.deepEqual(
      submission?.uploads.map((upload) => [upload.name, upload.contentType]),
      [["data.json", "application/json"]],
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("terminates oversized guest event frames without sending the oversized payload", () =>
  Effect.gen(function* () {
    const oversized = JSON.stringify({ text: "é".repeat(GUEST_STREAM_MAX_EVENT_BYTES / 2) });
    const response = eventStreamResponse(
      Stream.fromIterable([oversized, JSON.stringify({ type: "ended" })]),
      (json) => Effect.succeed(json),
    );
    if (response.body._tag !== "Stream") return assert.fail("Expected an event stream response.");
    const body = (yield* response.body.stream.pipe(
      Stream.decodeText,
      Stream.orDie,
      Stream.runCollect,
    )).join("");
    assert.isBelow(Buffer.byteLength(body), 1024);
    assert.deepEqual(
      body.split("\n\n").filter((frame) => frame.startsWith("event:") || frame.startsWith("data:")),
      ['event: guest-error\ndata: {"reason":"event_too_large"}'],
    );
  }),
);

it.effect("preserves a frame at the shared limit and the following terminal event", () =>
  Effect.gen(function* () {
    const overhead = Buffer.byteLength('data: {"text":""}\n\n');
    const json = JSON.stringify({ text: "x".repeat(GUEST_STREAM_MAX_EVENT_BYTES - overhead) });
    const terminal = JSON.stringify({ type: "ended" });
    const response = eventStreamResponse(Stream.fromIterable([json, terminal]), (event) =>
      Effect.succeed(event),
    );
    if (response.body._tag !== "Stream") return assert.fail("Expected an event stream response.");
    const body = (yield* response.body.stream.pipe(
      Stream.decodeText,
      Stream.orDie,
      Stream.runCollect,
    )).join("");
    assert.isTrue(body.startsWith(`data: ${json}\n\n`));
    assert.isTrue(body.includes(`data: ${terminal}\n\n`));
    assert.isFalse(body.includes("event: guest-error"));
  }),
);
