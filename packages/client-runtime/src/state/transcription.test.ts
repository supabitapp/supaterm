import { ProviderInstanceId, type ServerProvider } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { VoiceTranscriptionError } from "../voice-input/transcription.ts";
import {
  resolveVoiceTranscriptionSource,
  uploadVoiceRecording,
  VoiceUploadError,
  type VoiceUploadResponse,
} from "./transcription.ts";

const CLAUDE = ProviderInstanceId.make("claudeAgent");

const provider = (overrides: Partial<ServerProvider> = {}) =>
  ({
    instanceId: CLAUDE,
    displayName: "Claude",
    enabled: true,
    transcription: { status: "ready" },
    ...overrides,
  }) as ServerProvider;

const config = (providers: ReadonlyArray<ServerProvider>) => ({
  providers,
  settings: { transcriptionProviderInstanceId: CLAUDE },
});

describe("resolveVoiceTranscriptionSource", () => {
  it("uses only the configured instance and says why it can't", () => {
    expect(resolveVoiceTranscriptionSource(config([provider()])).status).toBe("ready");

    const codex = provider({ instanceId: ProviderInstanceId.make("codex") });
    expect(resolveVoiceTranscriptionSource(config([codex]))).toMatchObject({
      status: "unavailable",
      message: "The voice transcription provider isn't set up on this environment.",
    });
    expect(
      resolveVoiceTranscriptionSource(
        config([provider({ transcription: { status: "unavailable", reason: "signedOut" } })]),
      ),
    ).toMatchObject({
      status: "unavailable",
      message: "Sign in to this provider again to transcribe.",
    });
    expect(resolveVoiceTranscriptionSource(config([provider({ enabled: false })]))).toMatchObject({
      message: "Claude is turned off on this environment.",
    });
    expect(
      resolveVoiceTranscriptionSource(config([provider({ transcription: undefined })])),
    ).toMatchObject({ message: "Claude can't transcribe voice input." });
  });
});

const request = { sizeBytes: 6 };
const prepared = (n: number) => ({
  uploadId: "upload-1",
  relativeUrl: `/api/transcription/uploads/token-${n}`,
  expiresAt: 0,
});

function harness(responses: ReadonlyArray<VoiceUploadResponse | Error>) {
  let prepares = 0;
  const posted: string[] = [];
  const cancelled: string[] = [];
  const queue = [...responses];
  return {
    posted,
    cancelled,
    upload: (signal?: AbortSignal) =>
      uploadVoiceRecording({
        request,
        prepare: async () => prepared(++prepares),
        post: async (url) => {
          posted.push(url);
          const next = queue.shift();
          if (next instanceof Error) throw next;
          return next!;
        },
        cancel: async (uploadId) => cancelled.push(uploadId),
        ...(signal ? { signal } : {}),
      }),
  };
}

describe("uploadVoiceRecording", () => {
  it("prepares once more when the URL no longer exists, then returns the outcome", async () => {
    const run = harness([
      { status: 410, body: { _tag: "TranscriptionError", reason: "uploadExpired" } },
      {
        status: 200,
        body: { text: "ship it", submission: { status: "sent", sequence: 4 } },
      },
    ]);
    expect(await run.upload()).toEqual({
      text: "ship it",
      submission: { status: "sent", sequence: 4 },
    });
    expect(run.posted).toEqual([
      "/api/transcription/uploads/token-1",
      "/api/transcription/uploads/token-2",
    ]);
  });

  it("separates refusals the user must fix from failures worth sending again", async () => {
    const refused = await harness([
      { status: 422, body: { _tag: "TranscriptionError", reason: "signedOut" } },
    ])
      .upload()
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(VoiceUploadError);
    expect(refused).toMatchObject({
      reason: "signedOut",
      retryable: false,
      message: "Sign in to this provider again to transcribe.",
    });

    const limited = await harness([
      {
        status: 429,
        body: { _tag: "TranscriptionError", reason: "rateLimited", retryAfterMs: 2_500 },
      },
    ])
      .upload()
      .catch((error: unknown) => error);
    expect(limited).toMatchObject({
      retryable: true,
      message: "Transcription is rate limited. Try again soon. Try again in 3 s.",
    });

    const dropped = await harness([new TypeError("network")])
      .upload()
      .catch((error: unknown) => error);
    expect(dropped).toMatchObject({ reason: "disconnected", retryable: true });
  });

  it("cancels the server's work when the caller gives up mid-upload", async () => {
    const controller = new AbortController();
    const run = harness([]);
    const posting = Promise.withResolvers<void>();
    const upload = uploadVoiceRecording({
      request,
      prepare: async () => prepared(1),
      post: (_url, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted")));
          posting.resolve();
        }),
      cancel: async (uploadId) => run.cancelled.push(uploadId),
      signal: controller.signal,
    });
    await posting.promise;
    expect(run.cancelled).toEqual([]);
    controller.abort();

    await expect(upload).rejects.toBeInstanceOf(VoiceTranscriptionError);
    expect(run.cancelled).toEqual(["upload-1"]);
  });
});
