import { assert, it } from "@effect/vitest";
import { ProviderInstanceId } from "@supaterm/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import { CliToolFailedError, type ServerTools } from "./serverTools.ts";
import { transcribeRecording } from "./transcribe.ts";

const recording = new Uint8Array([1, 2, 3]);
const audioAttachmentId = "pending-recording.wav";
const input = { providerInstanceId: ProviderInstanceId.make("claudeAgent") };

const serverTools = (transcribe: Effect.Effect<unknown, CliToolFailedError>) => {
  const calls: Array<{ readonly tool: string; readonly args: unknown }> = [];
  const call = ((tool: string, args: unknown) =>
    Effect.suspend(() => {
      calls.push({ tool, args });
      if (tool === "supaterm_attachment_prepare_upload") {
        return Effect.succeed({
          attachmentId: audioAttachmentId,
          relativeUrl: "/upload",
          expiresAt: 0,
        });
      }
      return tool === "supaterm_transcription_transcribe" ? transcribe : Effect.succeed({});
    })) as ServerTools["call"];
  return { tools: { origin: "http://127.0.0.1:1", call } satisfies ServerTools, calls };
};

const acceptingUploads = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }))),
  ),
);

it.effect("a refused transcription deletes its upload", () =>
  Effect.gen(function* () {
    const { tools, calls } = serverTools(
      Effect.fail(
        new CliToolFailedError({
          tool: "supaterm_transcription_transcribe",
          detail: "Sign in to this provider again to transcribe.",
        }),
      ),
    );

    const error = yield* transcribeRecording(tools, recording, input).pipe(Effect.flip);

    assert.strictEqual(error.message, "Sign in to this provider again to transcribe.");
    assert.deepStrictEqual(calls.at(-1), {
      tool: "supaterm_transcription_cancel",
      args: { audioAttachmentId },
    });
  }).pipe(Effect.provide(acceptingUploads)),
);

// The server's run outlives the request, so stopping the command must stop it
// too or the account keeps paying for a transcript nobody reads.
it.effect("stopping the command stops the server's run", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const { tools, calls } = serverTools(
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    );

    const fiber = yield* transcribeRecording(tools, recording, input).pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* Fiber.interrupt(fiber);

    assert.deepStrictEqual(
      calls.map((entry) => entry.tool),
      [
        "supaterm_attachment_prepare_upload",
        "supaterm_transcription_transcribe",
        "supaterm_transcription_cancel",
      ],
    );
  }).pipe(Effect.provide(acceptingUploads)),
);
